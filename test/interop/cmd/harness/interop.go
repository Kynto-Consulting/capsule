package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"
)

// Go <-> JS interoperability: every client against the SAME gateway, the same destination servers and the same payloads.

func pattern(n int, seed uint32) []byte {
	b := make([]byte, n)
	x := seed
	if x == 0 {
		x = 1
	}
	for i := range b {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		b[i] = byte(x)
	}
	return b
}

type echoRes struct {
	OK      bool
	SentSha string
	GotSha  string
	GotN    int64
	Err     string
	Ms      int64
}

func goEcho(fam string, n int, svc, tok string) echoRes {
	t0 := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	conn, err := gw.DialConn(ctx, capURI("shop", svc, fam, false), &gw.Options{Token: tok, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		return echoRes{Err: err.Error()}
	}
	defer conn.Close()
	return echoOver(conn, conn.CloseWrite, n, t0)
}

func echoOver(conn net.Conn, closeWrite func() error, n int, t0 time.Time) echoRes {
	data := pattern(n, 12345)
	sent := sha256.Sum256(data)
	go func() {
		for off := 0; off < len(data); off += 64 << 10 {
			end := off + 64<<10
			if end > len(data) {
				end = len(data)
			}
			if _, err := conn.Write(data[off:end]); err != nil {
				return
			}
		}
		closeWrite()
	}()
	h := sha256.New()
	conn.SetReadDeadline(time.Now().Add(80 * time.Second))
	got, err := io.Copy(h, conn)
	r := echoRes{SentSha: hex.EncodeToString(sent[:]), GotSha: hex.EncodeToString(h.Sum(nil)), GotN: got, Ms: time.Since(t0).Milliseconds()}
	if err != nil {
		r.Err = err.Error()
	}
	r.OK = err == nil && r.SentSha == r.GotSha && got == int64(n)
	return r
}

func cliEcho(fam string, n int, svc, tok string) echoRes {
	t0 := time.Now()
	port := freePort()
	cmd := exec.Command(capsuleBin(), "connect", capURI("shop", svc, fam, false), "--listen", fmt.Sprintf("127.0.0.1:%d", port))
	cmd.Env = cliEnv(tok)
	var buf strings.Builder
	cmd.Stdout, cmd.Stderr = &buf, &buf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return echoRes{Err: err.Error()}
	}
	defer func() { syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); cmd.Wait(); tr("capsule connect (echo) stderr", []byte(buf.String())) }()
	if !waitFor(5*time.Second, 50*time.Millisecond, func() bool { l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); if err == nil { l.Close(); return false }; return true }) {
		return echoRes{Err: "listener did not start"}
	}
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return echoRes{Err: err.Error()}
	}
	defer c.Close()
	return echoOver(c, c.(*net.TCPConn).CloseWrite, n, t0)
}

func jsEcho(fam string, n int, svc, tok string) echoRes {
	o, _ := jsRun(map[string]any{"mode": "echo", "uri": capURI("shop", svc, fam, true), "bytes": n, "seed": 12345}, tok, 120*time.Second)
	if !o.ok() {
		return echoRes{Err: o.s("kind") + " " + o.s("message")}
	}
	r := echoRes{SentSha: o.s("sentSha"), GotSha: o.s("gotSha"), GotN: int64(o.f("got")), Ms: int64(o.f("ms"))}
	r.OK = r.SentSha == r.GotSha && r.GotN == int64(n)
	return r
}

func connsOpen() int {
	_, body := adminGet("127.0.0.1:19102", "/metrics")
	for _, l := range strings.Split(body, "\n") {
		if strings.HasPrefix(l, "gw_conns_open ") {
			v, _ := strconv.ParseFloat(strings.Fields(l)[1], 64)
			return int(v)
		}
	}
	return -1
}

func phaseInterop() {
	if long == nil {
		startLong()
	}
	fmt.Println("== interop: Go lib vs JS lib vs capsule CLI, same gateway, same vectors")
	sigs := map[string]map[string]echoRes{} // scenario|fam -> impl -> result
	record := func(key, impl string, r echoRes) {
		if sigs[key] == nil {
			sigs[key] = map[string]echoRes{}
		}
		sigs[key][impl] = r
	}
	sizes := []struct {
		name string
		n    int
	}{{"echo 1 KiB + half-close", 1 << 10}, {"echo 5 MB + half-close", 5 << 20}}
	for _, fam := range []string{"v4", "v6"} {
		for _, sz := range sizes {
			for _, im := range []struct {
				n string
				f func(string, int, string, string) echoRes
			}{{"Go lib", goEcho}, {"JS lib", jsEcho}, {"capsule connect", cliEcho}} {
				tok := C.CapOK
				if im.n == "capsule connect" {
					tok = cgsAll
				}
				r := im.f(fam, sz.n, "echo", tok)
				record(sz.name+"|"+fam, im.n, r)
				check("interop", "", im.n, fam, "cap_/cgs_", sz.name, fmt.Sprintf("ok=%v got=%d B %d ms %s", r.OK, r.GotN, r.Ms, trunc(r.Err, 80)), r.OK, "")
			}
		}
	}
	for k, m := range sigs {
		same := true
		var first string
		for _, r := range m {
			sig := fmt.Sprintf("%v/%s/%d", r.OK, r.GotSha, r.GotN)
			if first == "" {
				first = sig
			} else if sig != first {
				same = false
			}
		}
		check("interop", "", "Go=JS=CLI", strings.Split(k, "|")[1], "-", strings.Split(k, "|")[0]+": identical bytes received", fmt.Sprintf("%d implementations, identical=%v", len(m), same), same, "")
	}

	// server-initiated half-close and bulk directions through the bench service
	for _, fam := range []string{"v4", "v6"} {
		for _, im := range []string{"Go lib"} {
			r := goBenchDown(fam, 5<<20)
			check("interop", "", im, fam, "cap_", "5 MB download then server half-close: clean EOF, exact length", fmt.Sprintf("n=%d err=%s", r.GotN, trunc(r.Err, 80)), r.OK, "")
			up, err := goBenchUp(fam, 5<<20)
			check("interop", "", im, fam, "cap_", "5 MB upload acknowledged with the exact count", fmt.Sprintf("ack=%d err=%v", up, err), err == nil && up == 5<<20, "")
		}
	}

	// cancellation during the handshake (the invalid token is answered after the 300 ms uniform delay)
	for _, fam := range []string{"v4", "v6"} {
		bad := randTok("cap_")
		t0 := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
		_, err := gw.Dial(ctx, capURI("shop", "pg", fam, false), &gw.Options{Token: bad, RootCAs: C.CA, Retry: gw.NoRetry()})
		cancel()
		ms := time.Since(t0).Milliseconds()
		isCancel := err != nil && !errors.Is(err, gw.ErrNotAuthorized)
		check("interop", "", "Go lib", fam, "-", "cancel during handshake: returns at once, not NotAuthorized", fmt.Sprintf("%d ms err=%s", ms, trunc(errStr(err), 70)), isCancel && ms < 250, "")
		o, _ := jsRun(map[string]any{"mode": "cancel", "uri": capURI("shop", "pg", fam, true), "abortMs": 60}, bad, 30*time.Second)
		jsms := int64(o.f("ms"))
		check("interop", "", "JS lib", fam, "-", "cancel during handshake: returns at once, not NotAuthorized", fmt.Sprintf("%d ms kind=%s", jsms, o.s("kind")), !o.ok() && o.s("kind") != "NotAuthorized" && jsms < 1500, "node start-up included in ms")
	}
	// cancellation after the connection exists: the gateway must see the connection end
	for _, fam := range []string{"v4", "v6"} {
		time.Sleep(700 * time.Millisecond)
		base := connsOpen()
		ctx, cancel := context.WithCancel(context.Background())
		c, err := gw.Dial(ctx, capURI("shop", "echo", fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
		if err != nil {
			check("interop", "", "Go lib", fam, "-", "cancel after connect", err.Error(), false, "")
			cancel()
			continue
		}
		time.Sleep(300 * time.Millisecond)
		open1 := connsOpen()
		cancel()
		released := waitFor(3*time.Second, 100*time.Millisecond, func() bool { return connsOpen() <= base })
		c.Close()
		note := "Go convention: cancelling the Dial context after it returned does not close the connection (the caller closes it)"
		check("interop", "", "Go lib", fam, "-", "ctx cancel after Dial (informational: documents semantics)", fmt.Sprintf("open while connected=%d, released by cancel alone=%v", open1, released), true, note)
		base = connsOpen()
		o, _ := jsRun(map[string]any{"mode": "cancel", "uri": capURI("shop", "echo", fam, true), "abortMs": 1500, "after": true}, C.CapOK, 30*time.Second)
		time.Sleep(500 * time.Millisecond)
		check("interop", "", "JS lib", fam, "-", "AbortSignal after connect destroys the socket", fmt.Sprintf("destroyed=%v phase=%s", o["destroyed"], o.s("phase")), o["destroyed"] == true, "")
	}
	// retries: the destination is down (retryable Unavailable) and comes back after ~1.3 s
	for _, fam := range []string{"v4", "v6"} {
		targets.stop(55410)
		go func() { time.Sleep(1300 * time.Millisecond); targets.listen(55410, echoConn) }()
		t0 := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		conn, err := gw.Dial(ctx, capURI("shop", "flaky", fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA})
		ms := time.Since(t0).Milliseconds()
		okGo := false
		if err == nil {
			conn.Write([]byte("ping"))
			buf := make([]byte, 4)
			conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			_, e2 := io.ReadFull(conn, buf)
			okGo = e2 == nil && string(buf) == "ping"
			conn.Close()
		}
		cancel()
		check("interop", "", "Go lib", fam, "cap_", "retry until the destination returns", fmt.Sprintf("ok=%v after %d ms err=%v", okGo, ms, errStr(err)), okGo && ms >= 1000, "default RetryPolicy")
		targets.stop(55410)
		go func() { time.Sleep(1300 * time.Millisecond); targets.listen(55410, echoConn) }()
		o, _ := jsRun(map[string]any{"mode": "retry", "uri": capURI("shop", "flaky", fam, true)}, C.CapOK, 60*time.Second)
		check("interop", "", "JS lib", fam, "cap_", "retry until the destination returns", fmt.Sprintf("ok=%v same=%v after %d ms %s", o.ok(), o["same"], int64(o.f("ms")), trunc(o.s("message"), 60)), o.ok() && o["same"] == true && o.f("ms") >= 1000, "retry {8 attempts, 300 ms}")
		time.Sleep(1500 * time.Millisecond)
	}
	// the same refusal seen by both libraries: status 2, code 0x0201
	for _, fam := range []string{"v4", "v6"} {
		bad := randTok("cap_")
		_, err := gw.Dial(context.Background(), capURI("shop", "pg", fam, false), &gw.Options{Token: bad, RootCAs: C.CA, Retry: gw.NoRetry()})
		var ge *gw.GatewayError
		gs, gc := -1, -1
		if errors.As(err, &ge) {
			gs, gc = int(ge.Status), int(ge.Code)
		}
		o, _ := jsRun(map[string]any{"mode": "open", "uri": capURI("shop", "pg", fam, true)}, bad, 30*time.Second)
		js, jc := int(o.f("status")), int(o.f("code"))
		check("interop", "", "Go lib vs JS lib", fam, "invalid token", "same CAPR status/code (2 / 0x0201)", fmt.Sprintf("go=%d/0x%04x js=%d/0x%04x", gs, gc, js, jc), gs == 2 && gc == 0x201 && js == 2 && jc == 0x201, "")
	}
}

func errStr(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}

func goBenchDown(fam string, n int) echoRes {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c, err := gw.Dial(ctx, capURI("shop", "bench", fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		return echoRes{Err: err.Error()}
	}
	defer c.Close()
	var h [9]byte
	h[0] = 'D'
	binary.BigEndian.PutUint64(h[1:], uint64(n))
	c.Write(h[:])
	got, err := io.Copy(io.Discard, c)
	r := echoRes{GotN: got}
	if err != nil {
		r.Err = err.Error()
	}
	r.OK = err == nil && got == int64(n)
	return r
}

func goBenchUp(fam string, n int) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c, err := gw.DialConn(ctx, capURI("shop", "bench", fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		return 0, err
	}
	defer c.Close()
	var h [9]byte
	h[0] = 'U'
	binary.BigEndian.PutUint64(h[1:], uint64(n))
	c.Write(h[:])
	buf := make([]byte, 1<<20)
	for left := n; left > 0; {
		k := len(buf)
		if left < k {
			k = left
		}
		if _, err := c.Write(buf[:k]); err != nil {
			return 0, err
		}
		left -= k
	}
	var ack [8]byte
	if _, err := io.ReadFull(c, ack[:]); err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(ack[:])), nil
}
