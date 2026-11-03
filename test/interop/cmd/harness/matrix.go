package main

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"
)

// Outcome is what one client observed for one cell.
type Outcome struct {
	Class string // allow | deny | ipdeny | other
	Row   string // the value the real query returned (allow)
	Msg   string // the visible error (uniformity check)
	Exit  int
	Raw   string
}

type credDef struct {
	Name   string
	Expect string // allow | deny | ipdeny
	Fails  bool   // counts as a failed attempt for the per-IP brute-force limiter
	Svc    string // service override ("" = the client's base service)
}

var credDefs = []credDef{
	{Name: "cap_", Expect: "allow"},
	{Name: "cgs_", Expect: "allow"},
	{Name: "cgc_ (one use)", Expect: "allow"},
	{Name: "invalid token", Expect: "deny", Fails: true},
	{Name: "other org (cap_)", Expect: "deny", Fails: true},
	{Name: "scoped elsewhere", Expect: "deny", Fails: true},
	{Name: "ip not allowed", Expect: "ipdeny", Svc: "DENY"},
	{Name: "no such service", Expect: "deny", Fails: true, Svc: "nosuch"},
}

func randTok(prefix string) string {
	const al = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 40)
	for i := range b {
		b[i] = al[rand.Intn(len(al))]
	}
	t := prefix + string(b)
	noteSecret("invented token", t)
	return t
}

func tokenFor(cred, svc string) string {
	switch cred {
	case "cap_":
		return C.CapOK
	case "cgs_":
		return cgsAll
	case "cgc_ (one use)":
		return mintCGC(svc)
	case "invalid token":
		return randTok("cap_")
	case "other org (cap_)":
		return C.CapOther
	case "scoped elsewhere":
		return C.CapScoped
	default: // ip not allowed / no such service: a valid credential
		return C.CapOK
	}
}

func classify(err error) (string, string) {
	switch {
	case err == nil:
		return "allow", ""
	case errors.Is(err, gw.ErrIpDenied):
		return "ipdeny", err.Error()
	case errors.Is(err, gw.ErrNotAuthorized):
		return "deny", err.Error()
	}
	return "other", err.Error()
}

// ---- clients ----

type client struct {
	Name string
	Base string // base service ("pg" or "ssh")
	Run  func(fam, svc, tok string) Outcome
	Skip func(c credDef) string // non-empty = N/A with the reason
}

func goLib(fam, svc, tok string) Outcome { return goLibWith(capURI("shop", svc, fam, false), tok) }

func goLibWith(uri, tok string) Outcome {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := gw.Dial(ctx, uri, &gw.Options{Token: tok, RootCAs: C.CA, Retry: gw.NoRetry(), ConnectTimeout: 8 * time.Second})
	if err != nil {
		cl, msg := classify(err)
		return Outcome{Class: cl, Msg: msg}
	}
	defer conn.Close()
	row, err := pgQuery(conn, rowSQL)
	if err != nil {
		return Outcome{Class: "other", Msg: err.Error()}
	}
	return Outcome{Class: "allow", Row: row}
}

func jsLib(fam, svc, tok string) Outcome {
	o, raw := jsRun(map[string]any{"mode": "query", "uri": capURI("shop", svc, fam, true), "sql": rowSQL}, tok, 40*time.Second)
	if o.ok() {
		return Outcome{Class: "allow", Row: o.s("row"), Raw: raw}
	}
	switch o.s("kind") {
	case "NotAuthorized":
		return Outcome{Class: "deny", Msg: o.s("message"), Raw: raw}
	case "IpDenied":
		return Outcome{Class: "ipdeny", Msg: o.s("message"), Raw: raw}
	}
	return Outcome{Class: "other", Msg: o.s("message"), Raw: raw}
}

func cliEnv(tok string, extra ...string) []string {
	e := []string{"PATH=/usr/bin:/bin", "HOME=" + workHome, "CAPSULE_GATEWAY_CA_FILE=" + filepath.Join(C.W, "certs", "ca.crt"), "PGPASSWORD=app-pass-1", "PGCONNECT_TIMEOUT=15"}
	if tok != "" {
		e = append(e, "CAPSULE_GATEWAY_TOKEN="+tok)
	}
	return append(e, extra...)
}

func capsuleBin() string { return filepath.Join(C.Bin, "capsule") }

func cliClass(out string) string {
	switch {
	case strings.Contains(out, "IP de origen no está"):
		return "ipdeny"
	case strings.Contains(out, "no autorizado"):
		return "deny"
	}
	return "other"
}

func freePort() int {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	p := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return p
}

const psqlConn = "sslmode=require user=app dbname=app"

// capsule connect --listen + a real psql on the local port.
func cliListen(fam, svc, tok string) Outcome {
	port := freePort()
	cmd := exec.Command(capsuleBin(), "connect", capURI("shop", svc, fam, false), "--listen", fmt.Sprintf("127.0.0.1:%d", port))
	cmd.Env = cliEnv(tok)
	var buf strings.Builder
	cmd.Stdout, cmd.Stderr = &buf, &buf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return Outcome{Class: "other", Msg: err.Error()}
	}
	defer func() { syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); cmd.Wait() }()
	if !waitFor(5*time.Second, 50*time.Millisecond, func() bool { l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); if err == nil { l.Close(); return false }; return true }) {
		return Outcome{Class: "other", Msg: "local listener did not start: " + buf.String()}
	}
	out, code := run(cmdOpts{Env: cliEnv(""), Timeout: 40 * time.Second}, "psql", fmt.Sprintf("host=127.0.0.1 port=%d %s", port, psqlConn), "-Atc", rowSQL)
	time.Sleep(150 * time.Millisecond)
	all := buf.String()
	tr("capsule connect --listen stderr", []byte(all))
	if code == 0 {
		return Outcome{Class: "allow", Row: strings.TrimSpace(out), Exit: code}
	}
	return Outcome{Class: cliClass(all), Msg: firstLine(all), Exit: code, Raw: out}
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func cliExec(fam, svc, tok string) Outcome {
	out, code := run(cmdOpts{Env: cliEnv(tok), Timeout: 45 * time.Second}, capsuleBin(), "connect", capURI("shop", svc, fam, false), "--exec", "--", "psql", psqlConn, "-Atc", rowSQL)
	if code == 0 {
		return Outcome{Class: "allow", Row: lastLine(out), Exit: code}
	}
	return Outcome{Class: cliClass(out), Msg: firstLine(out), Exit: code, Raw: out}
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[i+1:])
	}
	return s
}

// capsule connect --stdio with a closed stdin: the exit code is the contract (0 ok, 4 denied, 3 no credentials, 2 usage).
func cliStdio(fam, svc, tok string) Outcome {
	out, code := run(cmdOpts{Env: cliEnv(tok), Timeout: 30 * time.Second, Stdin: strings.NewReader("")}, capsuleBin(), "connect", "--stdio", capURI("shop", svc, fam, false))
	cl := "other"
	switch code {
	case 0:
		cl = "allow"
	case 4:
		cl = cliClass(out)
		if cl == "other" {
			cl = "deny"
		}
	}
	return Outcome{Class: cl, Exit: code, Msg: firstLine(out), Row: "exit0"}
}

var sshOpts = []string{"-F", "/dev/null", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=20", "-o", "IdentitiesOnly=yes"}

func sshOut(code int, out string) Outcome {
	if code == 0 && strings.Contains(out, "interop-ssh-ok") {
		return Outcome{Class: "allow", Row: "interop-ssh-ok", Exit: code}
	}
	return Outcome{Class: cliClass(out), Msg: firstLine(out), Exit: code, Raw: out}
}

// capsule ssh --print -> take its ProxyCommand and give it to the stock ssh client.
func cliSSHPrint(fam, svc, tok string) Outcome {
	blk, code := run(cmdOpts{Env: cliEnv(tok), Timeout: 20 * time.Second}, capsuleBin(), "ssh", capURI("shop", svc, fam, false), "--print", "-l", "interop")
	if code != 0 {
		return Outcome{Class: "other", Msg: "ssh --print failed: " + firstLine(blk), Exit: code}
	}
	if strings.Contains(blk, "cap_") || strings.Contains(blk, "cgs_") || strings.Contains(blk, "cgc_") {
		return Outcome{Class: "other", Msg: "TOKEN VISIBLE IN ssh --print OUTPUT"}
	}
	proxy := ""
	alias := ""
	for _, l := range strings.Split(blk, "\n") {
		l = strings.TrimSpace(l)
		if v, ok := strings.CutPrefix(l, "ProxyCommand "); ok {
			proxy = v
		}
		if v, ok := strings.CutPrefix(l, "HostKeyAlias "); ok {
			alias = v
		}
	}
	args := append(append([]string{}, sshOpts...), "-o", "ProxyCommand="+proxy, "-o", "HostKeyAlias="+alias, "-i", sshKey, "-l", "interop", alias, "echo interop-ssh-ok")
	out, code := run(cmdOpts{Env: cliEnv(tok), Timeout: 45 * time.Second}, "ssh", args...)
	return sshOut(code, out)
}

// capsule ssh (no --print): the CLI launches ssh itself.
func cliSSHExec(fam, svc, tok string) Outcome {
	args := []string{"ssh", capURI("shop", svc, fam, false), "-l", "interop", "--"}
	args = append(args, sshOpts...)
	args = append(args, "-i", sshKey, "-o", "RemoteCommand=echo interop-ssh-ok")
	out, code := run(cmdOpts{Env: cliEnv(tok), Timeout: 45 * time.Second}, capsuleBin(), args...)
	return sshOut(code, out)
}

// ---- SNI clients: the credential is not part of this path, only the name and the IP list ----

func sniHost(svc string) string {
	if h, ok := svcHost[svc]; ok {
		return h
	}
	return svc + "-shop.db.interop.test" // a name that was never registered
}

func hostaddr(fam string) string {
	if fam == "v6" {
		return "::1"
	}
	return "127.0.0.1"
}

func psqlSNI(direct bool) func(fam, svc, tok string) Outcome {
	return func(fam, svc, tok string) Outcome {
		cs := fmt.Sprintf("host=%s hostaddr=%s port=%d sslmode=require user=app dbname=app connect_timeout=15", sniHost(svc), hostaddr(fam), C.GW)
		if direct {
			cs += " sslnegotiation=direct"
		}
		out, code := run(cmdOpts{Env: cliEnv(""), Timeout: 40 * time.Second}, "psql", cs, "-Atc", rowSQL)
		if code == 0 {
			return Outcome{Class: "allow", Row: lastLine(out), Exit: code}
		}
		return Outcome{Class: "deny", Msg: firstLine(out), Exit: code, Raw: out} // any failure: connection closed without hints
	}
}

// ssh through the SNI name with openssl s_client as ProxyCommand (the gateway terminates TLS and relays to sshd)
func sshSNI(fam, svc, tok string) Outcome {
	proxy := fmt.Sprintf("openssl s_client -quiet -connect %s:%d -servername %s -CAfile %s -verify_return_error -verify_hostname %s",
		strings.Trim(hostaddr(fam), "[]"), C.GW, sniHost(svc), filepath.Join(C.W, "certs", "ca.crt"), sniHost(svc))
	if fam == "v6" {
		proxy = strings.Replace(proxy, "-connect ::1:", "-connect [::1]:", 1)
	}
	args := append(append([]string{}, sshOpts...), "-o", "ProxyCommand="+proxy, "-i", sshKey, "-l", "interop", "sshbysni", "echo interop-ssh-ok")
	out, code := run(cmdOpts{Env: cliEnv(""), Timeout: 45 * time.Second}, "ssh", args...)
	if code == 0 && strings.Contains(out, "interop-ssh-ok") {
		return Outcome{Class: "allow", Row: "interop-ssh-ok", Exit: code}
	}
	return Outcome{Class: "deny", Msg: firstLine(out), Exit: code, Raw: out}
}

func skipToken(reason string) func(c credDef) string {
	return func(c credDef) string {
		switch c.Name {
		case "cap_", "cgs_", "cgc_ (one use)", "invalid token", "other org (cap_)", "scoped elsewhere":
			return reason
		}
		return ""
	}
}

func buildClients() []client {
	sniNote := "tokens do not take part in the SNI path (IP list only)"
	return []client{
		{Name: "Go lib (Dial+query)", Base: "pg", Run: goLib},
		{Name: "JS lib (connect+query)", Base: "pg", Run: jsLib},
		{Name: "capsule connect --listen+psql", Base: "pg", Run: cliListen},
		{Name: "capsule connect --exec psql", Base: "pg", Run: cliExec},
		{Name: "capsule connect --stdio (exit)", Base: "pg", Run: cliStdio},
		{Name: "capsule ssh --print+ssh", Base: "ssh", Run: cliSSHPrint},
		{Name: "capsule ssh (exec)", Base: "ssh", Run: cliSSHExec},
		{Name: "psql SNI classic", Base: "pg", Run: psqlSNI(false), Skip: skipToken(sniNote)},
		{Name: "psql SNI direct", Base: "pg", Run: psqlSNI(true), Skip: skipToken(sniNote)},
		{Name: "ssh ProxyCommand openssl SNI", Base: "ssh", Run: sshSNI, Skip: skipToken(sniNote)},
	}
}

// ---- brute-force limiter budget ----

var failBudget int

func restartPlane() {
	ctl("stop")
	gwctl("stop")
	time.Sleep(500 * time.Millisecond)
	ctl("start")
	gwctl("start")
	failBudget = 0
	waitRelay()
}

func phaseMatrix() {
	fmt.Println("== matrix: clients x {IPv4, ::1} x credentials")
	fams := []string{"v4", "v6"}
	for _, cl := range buildClients() {
		for _, fam := range fams {
			for _, cd := range credDefs {
				if cl.Skip != nil {
					if why := cl.Skip(cd); why != "" {
						rec(Res{Phase: "matrix", Client: cl.Name, Family: fam, Cred: cd.Name, Expect: "-", Got: "-", Status: "NA", Note: why})
						continue
					}
				}
				svc := cl.Base
				switch cd.Svc {
				case "DENY":
					svc = map[string]string{"pg": "pgdeny", "ssh": "sshdeny"}[cl.Base]
				case "nosuch":
					svc = "nosuch"
				}
				if cd.Fails || (cl.Skip != nil && cd.Svc == "nosuch") {
					if failBudget >= 6 {
						restartPlane()
					}
					failBudget++
				}
				tok := tokenFor(cd.Name, svc)
				if tok == "" && cd.Name != "no token" {
					check("matrix", "", cl.Name, fam, cd.Name, cd.Expect, "could not obtain token", false, "")
					continue
				}
				o := cl.Run(fam, svc, tok)
				ok, got, note := evalCell(cl, cd, o)
				check("matrix", "", cl.Name, fam, cd.Name, cd.Expect, got, ok, note)
				cellOutcomes[cl.Name+"|"+fam+"|"+cd.Name] = o
			}
		}
	}
	sniPositive()
	sshDocExample()
	// the one-use property of cgc_: the same token a second time is refused
	for _, fam := range fams {
		t := mintCGC("pg")
		o1 := goLib(fam, "pg", t)
		o2 := goLib(fam, "pg", t)
		check("matrix", "", "Go lib (Dial+query)", fam, "cgc_ replay", "1st allow, 2nd deny", o1.Class+" then "+o2.Class, o1.Class == "allow" && o2.Class == "deny", "")
	}
	uniformity()
}

var cellOutcomes = map[string]Outcome{}

func evalCell(cl client, cd credDef, o Outcome) (bool, string, string) {
	sni := cl.Skip != nil
	want := cd.Expect
	if sni && cd.Svc == "nosuch" {
		want = "deny"
	}
	got := o.Class
	switch want {
	case "allow":
		return o.Class == "allow", fmt.Sprintf("%s row=%q exit=%d %s", o.Class, o.Row, o.Exit, trunc(o.Msg, 100)), ""
	case "ipdeny":
		if sni || strings.Contains(cl.Name, "listen") && o.Class != "ipdeny" {
			// SNI path closes without a word; --listen shows the CLI message
			return o.Class != "allow", fmt.Sprintf("%s exit=%d %s", got, o.Exit, trunc(o.Msg, 80)), ""
		}
		return o.Class == "ipdeny", fmt.Sprintf("%s exit=%d %s", got, o.Exit, trunc(o.Msg, 80)), ""
	default: // deny
		exitOK := true
		if strings.Contains(cl.Name, "stdio") {
			exitOK = o.Exit == 4
		}
		ok := (o.Class == "deny" || (sni && o.Class != "allow")) && exitOK
		if o.Class == "allow" {
			ok = false
		}
		return ok, fmt.Sprintf("%s exit=%d %s", got, o.Exit, trunc(o.Msg, 80)), ""
	}
}

// uniformity: invalid token, other org, scoped elsewhere and non-existent service give the SAME visible error through the
// Go library and the JS library, and take the same time (T_UNIF) within a small tolerance.
func uniformity() {
	restartPlane()
	type samp struct {
		name string
		ms   []float64
		msg  map[string]bool
	}
	causes := []struct{ n, svc string }{{"invalid token", "pg"}, {"other org (cap_)", "pg"}, {"no such service", "nosuch"}}
	var ss []*samp
	for _, c := range causes {
		s := &samp{name: c.n, msg: map[string]bool{}}
		for i := 0; i < 3; i++ {
			tok := tokenFor(c.n, c.svc)
			t0 := time.Now()
			o := goLib("v4", c.svc, tok)
			s.ms = append(s.ms, float64(time.Since(t0).Milliseconds()))
			s.msg[o.Class+": "+o.Msg] = true
		}
		ss = append(ss, s)
	}
	all := map[string]bool{}
	var lo, hi float64 = 1e9, 0
	desc := []string{}
	for _, s := range ss {
		for k := range s.msg {
			all[k] = true
		}
		var sum float64
		for _, v := range s.ms {
			sum += v
			if v < lo {
				lo = v
			}
			if v > hi {
				hi = v
			}
		}
		desc = append(desc, fmt.Sprintf("%s avg %.0f ms", s.name, sum/float64(len(s.ms))))
	}
	check("matrix", "uniform-msg", "Go lib", "v4", "3 causes", "one identical error", fmt.Sprintf("%d distinct: %v", len(all), sortedKeys(all)), len(all) == 1, "")
	check("matrix", "uniform-time", "Go lib", "v4", "3 causes", "same latency (<=120 ms spread)", fmt.Sprintf("min %.0f max %.0f ms; %s", lo, hi, strings.Join(desc, "; ")), hi-lo <= 120, "T_UNIF")
	restartPlane()
}

func init() { _ = os.Stdout }

// The Windows <-> WSL relay learns about a new listener a moment after it starts: wait until the JS client (node.exe) can reach both families.
func waitRelay() {
	waitFor(20*time.Second, 500*time.Millisecond, func() bool {
		a, _ := jsRun(map[string]any{"mode": "open", "uri": capURI("shop", "pg", "v6", true)}, C.CapOK, 20*time.Second)
		b, _ := jsRun(map[string]any{"mode": "open", "uri": capURI("shop", "pg", "v4", true)}, C.CapOK, 20*time.Second)
		return a.ok() && b.ok()
	})
}

// SNI clients with the service that IS allowed by the IP list: the F1 headline (psql host=<name> sslmode=require, ssh through the name).
func sniPositive() {
	for _, cl := range buildClients() {
		if cl.Skip == nil {
			continue
		}
		for _, fam := range []string{"v4", "v6"} {
			o := cl.Run(fam, cl.Base, "")
			want := "interop-row-one"
			if cl.Base == "ssh" {
				want = "interop-ssh-ok"
			}
			check("matrix", "", cl.Name, fam, "allowed by IP list", "allow + real query/command", fmt.Sprintf("%s row=%q exit=%d %s", o.Class, o.Row, o.Exit, trunc(o.Msg, 110)), o.Class == "allow" && o.Row == want, "")
		}
	}
}

// The usage printed by `capsule ssh --help` (remote command after --) must work: the command lands AFTER the host alias.
func sshDocExample() {
	args := []string{"ssh", capURI("shop", "ssh", "v4", false), "-l", "interop", "--"}
	args = append(args, sshOpts...)
	args = append(args, "-i", sshKey, "whoami")
	out, code := run(cmdOpts{Env: cliEnv(C.CapOK), Timeout: 30 * time.Second}, capsuleBin(), args...)
	check("matrix", "ssh-doc", "capsule ssh (exec)", "v4", "cap_", "documented form `capsule ssh p/s -l u -- -i key <command>` runs the command", fmt.Sprintf("exit=%d %s", code, trunc(out, 110)), code == 0 && strings.Contains(out, "interop-ssh"),
		"DEFECT cli/cmd/capsule/sshcmd.go sshArgs: extra args are placed before the alias, so a trailing command is taken as the host name")
}
