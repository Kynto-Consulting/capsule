package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"
)

// ---- long-lived sessions: a 10 minute tunnel and a 10 minute SSH session that must survive everything below ----

type longConn struct {
	started   time.Time
	tunnel    net.Conn
	tunnelOK  atomic.Int64
	tunnelErr atomic.Value
	sshCmd    *exec.Cmd
	sshOut    *strings.Builder
	sshDone   chan struct{}
	sshCode   int
	churnStop chan struct{}
	revFirst  int64
	revLast   atomic.Int64
	toggles   atomic.Int64
	wg        sync.WaitGroup
}

var long *longConn

const longSeconds = 615

func routeRev() int64 {
	_, body := adminGet("127.0.0.1:19102", "/metrics")
	for _, l := range strings.Split(body, "\n") {
		if strings.HasPrefix(l, "gw_route_rev ") {
			v, _ := strconv.ParseFloat(strings.Fields(l)[1], 64)
			return int64(v)
		}
	}
	return -1
}

func startLong() {
	long = &longConn{started: time.Now(), sshDone: make(chan struct{}), churnStop: make(chan struct{}), sshOut: &strings.Builder{}}
	ctx := context.Background()
	c, err := gw.Dial(ctx, capURI("shop", "echo", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		check("long", "", "Go lib tunnel", "v4", "cap_", "10 min connection opens", err.Error(), false, "")
		return
	}
	long.tunnel = c
	long.wg.Add(1)
	go func() { // a 16 byte round trip every 20 s
		defer long.wg.Done()
		buf := make([]byte, 16)
		for i := 0; ; i++ {
			select {
			case <-long.churnStop:
				return
			case <-time.After(20 * time.Second):
			}
			msg := []byte(fmt.Sprintf("long-%010d", i))
			c.SetDeadline(time.Now().Add(15 * time.Second))
			if _, err := c.Write(msg); err != nil {
				long.tunnelErr.Store(err.Error())
				return
			}
			if _, err := io.ReadFull(c, buf); err != nil || string(buf) != string(msg) {
				long.tunnelErr.Store(fmt.Sprintf("read: %v", err))
				return
			}
			long.tunnelOK.Add(1)
		}
	}()
	// real OpenSSH session through capsule ssh --print's ProxyCommand
	blk, _ := run(cmdOpts{Env: cliEnv(C.CapOK), Timeout: 20 * time.Second}, capsuleBin(), "ssh", capURI("shop", "ssh2", "v4", false), "--print", "-l", "interop")
	proxy, alias := "", ""
	for _, l := range strings.Split(blk, "\n") {
		l = strings.TrimSpace(l)
		if v, ok := strings.CutPrefix(l, "ProxyCommand "); ok {
			proxy = v
		}
		if v, ok := strings.CutPrefix(l, "HostKeyAlias "); ok {
			alias = v
		}
	}
	args := append(append([]string{}, sshOpts...), "-o", "ProxyCommand="+proxy, "-o", "HostKeyAlias="+alias, "-o", "ServerAliveInterval=30", "-i", sshKey, "-l", "interop", alias, "ticks "+strconv.Itoa(longSeconds))
	cmd := exec.Command("ssh", args...)
	cmd.Env = cliEnv(C.CapOK)
	cmd.Stdout, cmd.Stderr = long.sshOut, long.sshOut
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		check("long", "", "ssh session", "v4", "cap_", "10 min SSH session starts", err.Error(), false, "")
		return
	}
	long.sshCmd = cmd
	go func() {
		err := cmd.Wait()
		long.sshCode = 0
		if xe, ok := err.(*exec.ExitError); ok {
			long.sshCode = xe.ExitCode()
		}
		close(long.sshDone)
	}()
	// route table churn: enable/disable the "hot" service every 40 s so the gateway reloads its table many times
	long.revFirst = routeRev()
	long.revLast.Store(long.revFirst)
	long.wg.Add(1)
	go func() {
		defer long.wg.Done()
		on := false
		for {
			select {
			case <-long.churnStop:
				if on {
					api("PATCH", "/services/churn", C.CapOK, map[string]any{"gateway_enabled": false})
				}
				return
			case <-time.After(40 * time.Second):
			}
			on = !on
			api("PATCH", "/services/churn", C.CapOK, map[string]any{"gateway_enabled": on})
			long.toggles.Add(1)
			time.Sleep(2 * time.Second)
			long.revLast.Store(routeRev())
		}
	}()
}

func phaseLong() {
	fmt.Println("== long: 10 minute tunnel and SSH session across route reloads, control restart, certificate reload, load")
	if long == nil || long.tunnel == nil {
		check("long", "", "10 min", "-", "-", "sessions alive", "never started", false, "")
		return
	}
	left := time.Until(long.started.Add(time.Duration(longSeconds+8) * time.Second))
	if left > 0 {
		fmt.Printf("waiting %s for the 10 minute mark\n", left.Round(time.Second))
		select {
		case <-long.sshDone:
		case <-time.After(left):
		}
	}
	<-long.sshDone
	close(long.churnStop)
	long.wg.Wait()
	age := time.Since(long.started)
	out := long.sshOut.String()
	ticks := strings.Count(out, "tick ")
	check("long", "", "ssh session (OpenSSH via capsule ssh ProxyCommand)", "v4", "cap_", ">= 10 min with server output every 15 s, exit 0",
		fmt.Sprintf("lived %s, exit=%d, ticks=%d, done=%v", age.Round(time.Second), long.sshCode, ticks, strings.Contains(out, "done")), long.sshCode == 0 && ticks >= 40 && strings.Contains(out, "done") && age >= 10*time.Minute, "")
	// tunnel: still alive after 10+ minutes
	buf := make([]byte, 16)
	msg := []byte("long-final-check")
	long.tunnel.SetDeadline(time.Now().Add(10 * time.Second))
	_, werr := long.tunnel.Write(msg)
	_, rerr := io.ReadFull(long.tunnel, buf)
	alive := werr == nil && rerr == nil && string(buf) == string(msg)
	e, _ := long.tunnelErr.Load().(string)
	check("long", "", "Go lib tunnel", "v4", "cap_", ">= 10 min alive, every 20 s probe echoed", fmt.Sprintf("alive=%v probes=%d err=%s lived=%s", alive, long.tunnelOK.Load(), e, age.Round(time.Second)), alive && e == "" && long.tunnelOK.Load() >= 25 && age >= 10*time.Minute, "")
	long.tunnel.Close()
	rev := routeRev()
	check("long", "", "route reloads during the sessions", "-", "-", ">= 10 table revisions seen by the gateway while they lived", fmt.Sprintf("gw_route_rev %d -> %d (%d enable/disable toggles)", long.revFirst, rev, long.toggles.Load()), rev-long.revFirst >= 10, "")
}

// ---- resilience ----

func routesSnapshot() (rev int64, n int) {
	st, b, _ := internal("GET", "/internal/gateway/routes?since=-1&wait=0")
	if st != 200 {
		return -1, 0
	}
	var s struct {
		Rev    int64             `json:"rev"`
		Routes []json.RawMessage `json:"routes"`
	}
	json.Unmarshal(b, &s)
	return s.Rev, len(s.Routes)
}

func tryDial(svc, fam string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	c, err := gw.Dial(ctx, capURI("shop", svc, fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		return err
	}
	c.Close()
	return nil
}

func gwStat(name string) (rss int, fds int) {
	pid, _ := os.ReadFile(filepath.Join(C.W, "run", name+".pid"))
	p := strings.TrimSpace(string(pid))
	st, _ := os.ReadFile("/proc/" + p + "/status")
	for _, l := range strings.Split(string(st), "\n") {
		if strings.HasPrefix(l, "VmRSS:") {
			rss, _ = strconv.Atoi(strings.Fields(l)[1])
		}
	}
	ents, _ := os.ReadDir("/proc/" + p + "/fd")
	return rss, len(ents)
}

func phaseResilience() {
	fmt.Println("== resilience")
	if long == nil {
		startLong()
	}
	// --- R2 hot route: revision, long-poll, effective time
	rev0, n0 := routesSnapshot()
	var wakeMs atomic.Int64
	var wakeRev atomic.Int64
	var wg sync.WaitGroup
	wg.Add(1)
	tPatch := time.Time{}
	go func() {
		defer wg.Done()
		t0 := time.Now()
		st, b, _ := internal("GET", fmt.Sprintf("/internal/gateway/routes?since=%d&wait=25", rev0))
		if st == 200 {
			var s struct{ Rev int64 `json:"rev"` }
			json.Unmarshal(b, &s)
			wakeRev.Store(s.Rev)
			if !tPatch.IsZero() {
				wakeMs.Store(time.Since(tPatch).Milliseconds())
			} else {
				wakeMs.Store(-1)
			}
		} else {
			wakeMs.Store(-int64(time.Since(t0).Milliseconds()) - 1000000)
		}
	}()
	time.Sleep(700 * time.Millisecond)
	beforeErr := tryDial("hot", "v4")
	tPatch = time.Now()
	st, _ := api("PATCH", "/services/hot", C.CapOK, map[string]any{"gateway_enabled": true})
	var up time.Duration
	okUp := waitFor(15*time.Second, 50*time.Millisecond, func() bool { return tryDial("hot", "v4") == nil })
	up = time.Since(tPatch)
	wg.Wait()
	rev1, n1 := routesSnapshot()
	check("resilience", "", "hot route add", "v4", "cap_", "service enabled -> route effective in the gateway in < 5 s", fmt.Sprintf("PATCH=%d, before: %s; effective after %d ms (ok=%v); routes %d -> %d, rev %d -> %d", st, trunc(errStr(beforeErr), 40), up.Milliseconds(), okUp, n0, n1, rev0, rev1), st == 200 && okUp && up < 5*time.Second && beforeErr != nil && rev1 > rev0 && n1 == n0+1, "")
	check("resilience", "", "route long-poll", "-", "-", "GET /internal/gateway/routes?since=<rev> answers at the change, not at the timeout", fmt.Sprintf("woke %d ms after the change, rev %d (wait was 25 s)", wakeMs.Load(), wakeRev.Load()), wakeMs.Load() >= 0 && wakeMs.Load() < 3000 && wakeRev.Load() > rev0, "")
	t1 := time.Now()
	stt, bb, _ := internal("GET", fmt.Sprintf("/internal/gateway/routes?since=%d&wait=3", rev1))
	d := time.Since(t1)
	check("resilience", "", "route long-poll", "-", "-", "unchanged revision: 304 after ~wait", fmt.Sprintf("HTTP %d after %d ms (%s)", stt, d.Milliseconds(), trunc(string(bb), 40)), stt == 304 && d >= 2500*time.Millisecond && d < 5*time.Second, "")
	tOff := time.Now()
	api("PATCH", "/services/hot", C.CapOK, map[string]any{"gateway_enabled": false})
	okDown := waitFor(15*time.Second, 50*time.Millisecond, func() bool { return tryDial("hot", "v4") != nil })
	down := time.Since(tOff)
	check("resilience", "", "hot route remove", "v4", "cap_", "service disabled -> connection refused within seconds", fmt.Sprintf("refused after %d ms (ok=%v)", down.Milliseconds(), okDown), okDown && down < 5*time.Second, "")

	// --- R1 control restart with the gateway serving the last table
	probe, err := gw.Dial(context.Background(), capURI("shop", "echo", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		check("resilience", "", "control restart", "v4", "-", "probe connection opens", err.Error(), false, "")
		return
	}
	ctl("stop")
	time.Sleep(1500 * time.Millisecond)
	ready, rb := adminGet("127.0.0.1:19102", "/readyz")
	_, nroutes := adminMetric("gw_routes")
	probe.SetDeadline(time.Now().Add(5 * time.Second))
	probe.Write([]byte("alive-with-control-down"))
	pb := make([]byte, 23)
	_, perr := io.ReadFull(probe, pb)
	newErr := tryDial("pg", "v4")
	check("resilience", "", "control down", "v4", "-", "gateway stays ready with its table; open connection keeps working", fmt.Sprintf("/readyz=%d (%s), routes in table=%.0f, open connection echo err=%v", ready, trunc(rb, 30), nroutes, perr), ready == 200 && nroutes > 5 && perr == nil, "")
	check("resilience", "", "control down", "v4", "cap_", "new connections while the control plane is down (fail closed, AuthStale=0)", "refused: "+trunc(errStr(newErr), 80), newErr != nil, "documented behaviour: authorisation needs the control plane")
	// a gateway process started while the control plane is down loads the table from its cache file
	out, code := gwctl("start", "GW_NAME=gwcache", "GW_ADMIN=127.0.0.1:19105", "GW_LISTEN=127.0.0.1:18490")
	_, cr := adminGet("127.0.0.1:19105", "/readyz")
	_, nr := adminMetricAt("127.0.0.1:19105", "gw_routes")
	check("resilience", "", "gateway restart, control down", "-", "-", "a new gateway process serves the table of its cache file", fmt.Sprintf("start code=%d (%s) /readyz=%s routes=%.0f", code, trunc(out, 50), trunc(cr, 30), nr), code == 0 && nr > 5, "")
	gwctl("stop", "GW_NAME=gwcache")
	ctl("start")
	tBack := time.Now()
	okBack := waitFor(40*time.Second, 300*time.Millisecond, func() bool { return tryDial("pg", "v4") == nil })
	check("resilience", "", "control back", "v4", "cap_", "new connections work again after the control plane returns", fmt.Sprintf("ok=%v after %s", okBack, time.Since(tBack).Round(time.Millisecond)), okBack, "")
	probe.Close()

	// --- R3 certificates by SIGHUP
	serial := func() string {
		o, _ := sh(fmt.Sprintf("echo | openssl s_client -connect 127.0.0.1:%d -servername tcp.interop.test 2>/dev/null | openssl x509 -noout -serial -ext subjectAltName 2>/dev/null | tr '\\n' ' '", C.GW))
		return strings.TrimSpace(o)
	}
	s0 := serial()
	hold, herr := gw.Dial(context.Background(), capURI("shop", "echo", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	sh(fmt.Sprintf("cd %s/certs && cp gw2.crt gw.crt.new && cp gw2.key gw.key.new && mv gw.crt.new gw.crt && mv gw.key.new gw.key", C.W))
	gwctl("reload")
	time.Sleep(700 * time.Millisecond)
	s1 := serial()
	opened := tryDial("pg", "v4")
	jsOpen, _ := jsRun(map[string]any{"mode": "open", "uri": capURI("shop", "pg", "v6", true)}, C.CapOK, 30*time.Second)
	holdOK := false
	if herr == nil {
		hold.SetDeadline(time.Now().Add(5 * time.Second))
		hold.Write([]byte("cert-reload-ok"))
		hb := make([]byte, 14)
		_, e := io.ReadFull(hold, hb)
		holdOK = e == nil && string(hb) == "cert-reload-ok"
	}
	check("resilience", "", "SIGHUP certificate reload", "v4", "-", "new certificate served, open connection unaffected, new connections verify", fmt.Sprintf("served cert changed=%v; open conn ok=%v; Go new conn err=%v; JS ok=%v", s0 != s1 && s1 != "", holdOK, opened, jsOpen.ok()), s0 != s1 && s1 != "" && holdOK && opened == nil && jsOpen.ok(), trunc(s1, 90))
	// a broken file must not take the gateway down: the previous certificate stays
	sh(fmt.Sprintf("cd %s/certs && cp gw.crt gw.crt.good && echo garbage > gw.crt", C.W))
	gwctl("reload")
	time.Sleep(700 * time.Millisecond)
	s2 := serial()
	stillOK := tryDial("pg", "v4")
	lg, _ := sh(fmt.Sprintf("grep -c 'certificate reload failed' %s/gateway.log", C.W))
	sh(fmt.Sprintf("cd %s/certs && mv gw.crt.good gw.crt", C.W))
	gwctl("reload")
	check("resilience", "", "SIGHUP broken certificate", "v4", "-", "reload fails, previous certificate kept, error logged, service continues", fmt.Sprintf("cert unchanged=%v; new conn err=%v; 'reload failed' log lines=%s", s2 == s1, stillOK, strings.TrimSpace(lg)), s2 == s1 && stillOK == nil && strings.TrimSpace(lg) != "0", "")
	hold.Close()
}

func adminMetric(name string) (int, float64) { return adminMetricAt("127.0.0.1:19102", name) }

func adminMetricAt(addr, name string) (int, float64) {
	st, body := adminGet(addr, "/metrics")
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		l := sc.Text()
		if strings.HasPrefix(l, name+" ") {
			v, _ := strconv.ParseFloat(strings.Fields(l)[1], 64)
			return st, v
		}
	}
	return st, -1
}

// ---- drain: the update procedure of the gateway (second process on the same ports, SIGTERM to the old one) ----

func phaseDrain() {
	fmt.Println("== drain: update without cutting connections")
	hold, err := gw.Dial(context.Background(), capURI("shop", "echo", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		check("drain", "", "drain", "v4", "-", "open a connection on the old process", err.Error(), false, "")
		return
	}
	out, code := gwctl("start", "GW_NAME=gwnew", "GW_ADMIN=127.0.0.1:19103")
	if code != 0 {
		check("drain", "", "drain", "-", "-", "second process starts on the same ports (SO_REUSEPORT)", trunc(out, 120), false, "")
		return
	}
	oldPid, _ := os.ReadFile(filepath.Join(C.W, "run", "gateway.pid"))
	gwctl("term")
	// new connections during and after the grace window
	var okN, failN int
	var failTimes []string
	t0 := time.Now()
	for time.Since(t0) < 5*time.Second {
		if err := tryDial("pg", "v4"); err == nil {
			okN++
		} else {
			failN++
			failTimes = append(failTimes, fmt.Sprintf("%dms", time.Since(t0).Milliseconds()))
		}
		time.Sleep(120 * time.Millisecond)
	}
	// the old process: draining, still serving the open connection
	st, drain := adminMetric("gw_draining")
	hold.SetDeadline(time.Now().Add(5 * time.Second))
	hold.Write([]byte("still-served-by-old"))
	hb := make([]byte, 19)
	_, herr := io.ReadFull(hold, hb)
	running := syscall.Kill(atoi(string(oldPid)), 0) == nil
	check("drain", "", "SIGTERM to the old process", "v4", "cap_", "old process keeps serving the open connection and stays alive while it is open", fmt.Sprintf("echo through old=%v, old pid alive=%v, gw_draining=%.0f (admin HTTP %d)", herr == nil, running, drain, st), herr == nil && running, "")
	check("drain", "", "new connections during the update", "v4", "cap_", "none refused: the new process serves them (the old one has stopped listening after DrainGrace)", fmt.Sprintf("%d ok, %d refused in 5 s; refused at %v", okN, failN, failTimes), failN == 0, "SO_REUSEPORT keeps the old socket in the group during DrainGrace (2 s): connections hashed to it are refused")
	hold.Close()
	gone := waitFor(15*time.Second, 200*time.Millisecond, func() bool { return syscall.Kill(atoi(string(oldPid)), 0) != nil })
	check("drain", "", "old process exit", "-", "-", "exits by itself once its last connection ends", fmt.Sprintf("exited=%v", gone), gone, "")
	after := tryDial("pg", "v4")
	check("drain", "", "new process after the old one left", "v4", "cap_", "serves", errStr(after), after == nil, "")
	gwctl("stop", "GW_NAME=gwnew")
	gwctl("start")
	waitRelay()
}

func atoi(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
