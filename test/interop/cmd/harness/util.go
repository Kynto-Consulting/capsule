package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Cfg is everything the phases need to know about the environment the shell scripts prepared.
type Cfg struct {
	W     string // work dir (/tmp/capsule-interop)
	Dir   string // test/interop
	Bin   string // test/interop/bin
	CAPem []byte
	CA    *x509.CertPool
	CAWin string // Windows path of the CA copy (for node.exe)
	WslIP string
	GW    int // gateway port

	CapOK, CapOther, CapScoped string

	Org, Proj string // control plane ids
	API       string // .../gateway
	Secret    string // X-Gateway-Secret
}

var C Cfg

const (
	orgID  = "00000000-0000-0000-0000-0000000000b1"
	projID = "00000000-0000-0000-0000-0000000000c1"
)

// ---- transcript: everything a tool printed, scanned at the end for secrets ----

var (
	trMu       sync.Mutex
	transcript bytes.Buffer
)

func tr(label string, b []byte) {
	trMu.Lock()
	defer trMu.Unlock()
	fmt.Fprintf(&transcript, "\n--- %s\n", label)
	transcript.Write(b)
}

// ---- results ----

type Res struct {
	Phase  string `json:"phase"`
	ID     string `json:"id"`
	Client string `json:"client"`
	Family string `json:"family"`
	Cred   string `json:"cred"`
	Expect string `json:"expect"`
	Got    string `json:"got"`
	Status string `json:"status"` // PASA | FALLA | NA
	Note   string `json:"note,omitempty"`
}

var (
	resMu   sync.Mutex
	results []Res
)

func rec(r Res) {
	resMu.Lock()
	results = append(results, r)
	resMu.Unlock()
	mark := map[string]string{"PASA": "ok  ", "FALLA": "FAIL", "NA": "n/a "}[r.Status]
	fmt.Printf("[%s] %s %-22s %-4s %-14s expect=%q got=%q %s\n", mark, r.Phase, r.Client, r.Family, r.Cred, r.Expect, trunc(r.Got, 90), r.Note)
}

func check(phase, id, client, family, cred, expect, got string, ok bool, note string) bool {
	st := "PASA"
	if !ok {
		st = "FALLA"
	}
	rec(Res{Phase: phase, ID: id, Client: client, Family: family, Cred: cred, Expect: expect, Got: got, Status: st, Note: note})
	return ok
}

func trunc(s string, n int) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\n", " | ")
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

// ---- processes ----

type cmdOpts struct {
	Env     []string // full replacement when non-nil, else the process environment
	Stdin   io.Reader
	Timeout time.Duration
	Dir     string
}

func run(o cmdOpts, name string, args ...string) (out string, code int) {
	if o.Timeout == 0 {
		o.Timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), o.Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = o.Dir
	if o.Env != nil {
		cmd.Env = o.Env
	}
	cmd.Stdin = o.Stdin
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	err := cmd.Run()
	code = 0
	if err != nil {
		if xe, ok := err.(*exec.ExitError); ok {
			code = xe.ExitCode()
		} else {
			code = -1
			buf.WriteString("\n[run error] " + err.Error())
		}
	}
	if ctx.Err() == context.DeadlineExceeded {
		code = -2
		buf.WriteString("\n[timeout]")
	}
	tr(name+" "+strings.Join(redactArgs(args), " "), buf.Bytes())
	return buf.String(), code
}

// redactArgs: tokens never travel on a command line in this harness (they use the environment), but be safe in the transcript label.
func redactArgs(a []string) []string {
	out := make([]string, len(a))
	for i, s := range a {
		out[i] = s
		if strings.Contains(s, "cap_") || strings.Contains(s, "cgs_") || strings.Contains(s, "cgc_") {
			out[i] = "[arg-with-token]"
		}
	}
	return out
}

func script(name string, env ...string) (string, int) {
	e := append(os.Environ(), "W="+C.W)
	e = append(e, env...)
	return run(cmdOpts{Env: e, Timeout: 90 * time.Second}, filepath.Join(C.Dir, name+".sh"), argsOf(name)...)
}

func argsOf(name string) []string { return nil }

func sh(cmdline string, env ...string) (string, int) {
	e := append(os.Environ(), "W="+C.W)
	e = append(e, env...)
	return run(cmdOpts{Env: e, Timeout: 90 * time.Second}, "bash", "-c", cmdline)
}

func ctl(action string, env ...string) (string, int) {
	return sh(filepath.Join(C.Dir, "control.sh")+" "+action, env...)
}

func gwctl(action string, env ...string) (string, int) {
	return sh(filepath.Join(C.Dir, "gateway.sh")+" "+action, env...)
}

// ---- HTTP against the control plane ----

var hc = &http.Client{Timeout: 30 * time.Second}

func api(method, path string, tok string, body any) (int, []byte) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, C.API+path, rd)
	req.Host = "localhost:18080"
	req.Header.Set("Authorization", "Bearer "+tok)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, []byte(err.Error())
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func internal(method, path string) (int, []byte, http.Header) {
	req, _ := http.NewRequest(method, "http://127.0.0.1:18080"+path, nil)
	req.Header.Set("X-Gateway-Secret", C.Secret)
	resp, err := hc.Do(req)
	if err != nil {
		return 0, []byte(err.Error()), nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b, resp.Header
}

func adminGet(addr, path string) (int, string) {
	resp, err := hc.Get("http://" + addr + path)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func sha(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func psqlCtl(sql string) string {
	out, _ := sh(`PGPASSWORD=interop-pg-pass psql -h 127.0.0.1 -p 55440 -U postgres -d capsule -At -F '|' -c "` + strings.ReplaceAll(sql, `"`, `\"`) + `"`)
	return strings.TrimSpace(out)
}

func sortedKeys[V any](m map[string]V) []string {
	k := make([]string, 0, len(m))
	for x := range m {
		k = append(k, x)
	}
	sort.Strings(k)
	return k
}

func must(err error, what string) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL %s: %v\n", what, err)
		os.Exit(3)
	}
}

func waitFor(d time.Duration, every time.Duration, f func() bool) bool {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if f() {
			return true
		}
		time.Sleep(every)
	}
	return f()
}

// startBg starts a process in its own group and returns the function that kills it and records its output in the transcript.
func startBg(bin string, env []string, args ...string) func() {
	cmd := exec.Command(bin, args...)
	cmd.Env = env
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return func() {}
	}
	return func() {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		cmd.Wait()
		tr(bin+" (background) output", buf.Bytes())
	}
}
