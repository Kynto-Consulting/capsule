package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"
	"golang.org/x/crypto/bcrypt"
)

// Second run: login -> connect with a JWT session, expired cgc_, random-port pool (TCP and UDP), UDP tunnel with both libraries,
// access by name with an empty IP list.

func udpURI(svc, fam string, js bool) string {
	q := url.Values{}
	q.Set("gateway", gwAddr(fam, js))
	q.Set("sni", "udp.interop.test")
	q.Set("transport", "udp")
	return fmt.Sprintf("capsule://shop/%s?%s", svc, q.Encode())
}

// ---- (b) tokens signed with the real signing seed, but expired / wrong route / wrong key ----

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func forgeCGC(seed []byte, route string, iat, exp time.Time) string {
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	h := sha256.Sum256(pub)
	kid := hex.EncodeToString(h[:8])
	hb, _ := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "cgc", "kid": kid})
	pb, _ := json.Marshal(map[string]any{"sub": "00000000-0000-0000-0000-0000000000a1", "route": route, "iat": iat.Unix(), "nbf": iat.Unix(), "exp": exp.Unix(), "jti": b64([]byte(fmt.Sprint(time.Now().UnixNano()))), "kid": kid})
	signing := b64(hb) + "." + b64(pb)
	tok := "cgc_" + signing + "." + b64(ed25519.Sign(priv, []byte(signing)))
	noteSecret("forged cgc_ token", tok)
	return tok
}

func phaseSecond() {
	fmt.Println("== second run: expired cgc_, login flow, pool, UDP tunnel, empty IP list")
	waitRelay()
	expiredCGC()
	emptyList()
	loginFlow()
	poolPorts()
	udpTunnel()
}

func expiredCGC() {
	seed := []byte("interop-signing-seed-0123456789!")
	now := time.Now()
	expired := forgeCGC(seed, "shop/pg", now.Add(-10*time.Minute), now.Add(-5*time.Minute))
	badSig := forgeCGC([]byte("another-seed-another-seed-xxxxxx"), "shop/pg", now, now.Add(4*time.Minute))
	wrongRoute := forgeCGC(seed, "shop/ssh", now, now.Add(4*time.Minute))
	valid := forgeCGC(seed, "shop/pg", now, now.Add(4*time.Minute)) // signed with the real seed but not issued by the API: sub is a real user
	for _, fam := range []string{"v4", "v6"} {
		_, e := gw.Dial(context.Background(), capURI("shop", "pg", fam, false), &gw.Options{Token: expired, RootCAs: C.CA, Retry: gw.NoRetry()})
		check("second", "cgc-expired", "Go lib", fam, "cgc_ expired", "TokenExpired (status 2 code 0x0202)", errStr(e), errors.Is(e, gw.ErrTokenExpired), "")
		o, _ := jsRun(map[string]any{"mode": "open", "uri": capURI("shop", "pg", fam, true)}, expired, 30*time.Second)
		check("second", "cgc-expired", "JS lib", fam, "cgc_ expired", "TokenExpired (status 2 code 0x0202)", o.s("kind")+" "+o.s("code"), o.s("kind") == "TokenExpired", "")
		out, code := run(cmdOpts{Env: cliEnv(expired), Timeout: 30 * time.Second, Stdin: strings.NewReader("")}, capsuleBin(), "connect", "--stdio", capURI("shop", "pg", fam, false))
		check("second", "cgc-expired", "capsule connect --stdio", fam, "cgc_ expired", "exit code 3 (credentials expired)", fmt.Sprintf("exit %d %s", code, trunc(out, 80)), code == 3, "")
	}
	_, e1 := gw.Dial(context.Background(), capURI("shop", "pg", "v4", false), &gw.Options{Token: badSig, RootCAs: C.CA, Retry: gw.NoRetry()})
	_, e2 := gw.Dial(context.Background(), capURI("shop", "pg", "v4", false), &gw.Options{Token: wrongRoute, RootCAs: C.CA, Retry: gw.NoRetry()})
	check("second", "cgc-bad", "Go lib", "v4", "cgc_ wrong key / wrong route", "NotAuthorized, uniform (0x0201), never TokenExpired", errStr(e1)+" || "+errStr(e2), errors.Is(e1, gw.ErrNotAuthorized) && errors.Is(e2, gw.ErrNotAuthorized), "")
	o := goLibWith(capURI("shop", "pg", "v4", false), valid)
	check("second", "cgc-forged-valid", "Go lib", "v4", "cgc_ signed with the seed, valid window", "accepted (the signature is what proves issuance)", o.Class+" "+o.Row, o.Class == "allow", "informational: anyone holding the seed can mint tokens, as intended")
}

func emptyList() {
	for _, fam := range []string{"v4", "v6"} {
		o := psqlSNI(false)(fam, "pgempty", "")
		check("second", "empty-list", "psql SNI classic", fam, "-", "service with an EMPTY IP list denies by name", fmt.Sprintf("%s exit=%d %s", o.Class, o.Exit, trunc(o.Msg, 70)), o.Class != "allow", "")
		o2 := psqlSNI(true)(fam, "pgempty", "")
		check("second", "empty-list", "psql SNI direct", fam, "-", "service with an EMPTY IP list denies by name", fmt.Sprintf("%s exit=%d", o2.Class, o2.Exit), o2.Class != "allow", "")
		g := goLib(fam, "pgempty", C.CapOK)
		check("second", "empty-list", "Go lib (capsule/1)", fam, "cap_", "valid token, empty list -> IpDenied", g.Class+" "+trunc(g.Msg, 60), g.Class == "ipdeny", "")
	}
	// control plane decision itself
	st, b, _ := internal("GET", "/internal/gateway/routes?wait=0")
	_ = st
	var snap struct {
		Routes []struct{ ID, Service string } `json:"routes"`
	}
	json.Unmarshal(b, &snap)
	for _, r := range snap.Routes {
		if r.Service == "pgempty" {
			code, body := authorizeNone(r.ID, "127.0.0.1")
			check("second", "empty-list", "POST /internal/gateway/authorize none+sni_name", "v4", "none", "allow:false for an empty list", fmt.Sprintf("HTTP %d %s", code, trunc(body, 80)), strings.Contains(body, `"allow":false`), "")
		}
	}
}

func authorizeNone(route, ip string) (int, string) {
	return postInternal("/internal/gateway/authorize", map[string]any{"route_id": route, "src_ip": ip, "credential_type": "none", "access": "sni_name"})
}

// ---- (a) real login, then connect with the session ----

func loginFlow() {
	email := "login@interop.test"
	hash, _ := bcrypt.GenerateFromPassword([]byte("login-pass-12345"), 10)
	noteSecret("login password", "login-pass-12345")
	psqlExec("insert into users (id,email,password_hash,name) values ('00000000-0000-0000-0000-0000000000a3','" + email + "','" + string(hash) + "','Login User')")
	psqlExec("insert into org_members (org_id,user_id,role) values ('" + orgID + "','00000000-0000-0000-0000-0000000000a3','owner')")
	st, b := rawAPI("POST", "/api/v1/auth/login", "", map[string]any{"email": email, "password": "login-pass-12345"})
	var lr struct {
		AccessToken string `json:"access_token"`
		Tokens      struct {
			Access string `json:"access_token"`
		} `json:"tokens"`
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	json.Unmarshal(b, &lr)
	jwt := firstNonEmpty(lr.AccessToken, firstNonEmpty(lr.Tokens.Access, lr.Data.AccessToken))
	noteSecret("JWT access token", jwt)
	if st != 200 || jwt == "" {
		check("second", "login", "login", "-", "-", "JWT obtained", fmt.Sprintf("HTTP %d %s", st, trunc(string(b), 100)), false, "")
		return
	}
	env := func(extra ...string) []string {
		e := []string{"PATH=/usr/bin:/bin", "HOME=" + workHome, "CAPSULE_GATEWAY_CA_FILE=" + C.W + "/certs/ca.crt", "PGPASSWORD=app-pass-1", "CAPSULE_TOKEN=" + jwt, "CAPSULE_API_URL=http://localhost:18080", "CAPSULE_ORG_ID=" + orgID}
		return append(e, extra...)
	}
	for _, fam := range []string{"v4", "v6"} {
		out, code := run(cmdOpts{Env: env(), Timeout: 60 * time.Second}, capsuleBin(), "connect", capURI("shop", "pg", fam, false), "--exec", "--", "psql", psqlConn, "-Atc", rowSQL)
		check("second", "login", "capsule connect --exec (JWT session -> cgc_)", fam, "login session", "mints a one-use cgc_ from the real API and runs the query", fmt.Sprintf("exit=%d %s", code, trunc(out, 90)), code == 0 && strings.Contains(out, "interop-row-one"), "")
		out, code = run(cmdOpts{Env: env(), Timeout: 30 * time.Second, Stdin: strings.NewReader("")}, capsuleBin(), "connect", "--stdio", capURI("shop", "pg", fam, false))
		check("second", "login", "capsule connect --stdio (JWT session)", fam, "login session", "exit 0", fmt.Sprintf("exit=%d %s", code, trunc(out, 90)), code == 0, "")
	}
	out, code := run(cmdOpts{Env: env(), Timeout: 30 * time.Second}, capsuleBin(), "ssh", capURI("shop", "ssh", "v4", false), "-l", "interop", "--", "-F", "/dev/null", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR", "-i", sshKey, "whoami")
	check("second", "login", "capsule ssh (JWT session, remote command after --)", "v4", "login session", "runs the command (H2 fix) with a minted cgc_", fmt.Sprintf("exit=%d %s", code, trunc(out, 80)), code == 0 && strings.Contains(out, "interop-ssh-one"), "")
	// no org configured: a clear error and exit 3
	e := env()
	e = e[:len(e)-1]
	out, code = run(cmdOpts{Env: e, Timeout: 30 * time.Second, Stdin: strings.NewReader("")}, capsuleBin(), "connect", "--stdio", capURI("shop", "pg", "v4", false))
	check("second", "login", "capsule connect --stdio (session without org)", "v4", "login session", "clear message, non-zero exit", fmt.Sprintf("exit=%d %s", code, trunc(out, 120)), code != 0 && !strings.Contains(out, "panic"), "")
}

// ---- (c) random port pool ----

type leaseInfo struct {
	Port int `json:"port"`
}

func lease(svc string) (int, string) {
	st, b := api("POST", "/services/"+svc+"/port", C.CapOK, map[string]any{})
	var l leaseInfo
	json.Unmarshal(b, &l)
	if st != 200 && st != 201 {
		return 0, fmt.Sprintf("HTTP %d %s", st, trunc(string(b), 120))
	}
	return l.Port, ""
}

func hostFor(fam string) string {
	if fam == "v6" {
		return "[::1]"
	}
	return "127.0.0.1"
}

func ncEcho(fam string, port int, udp bool) (string, int) {
	h := strings.Trim(hostFor(fam), "[]")
	flag := "-w3"
	if udp {
		flag = "-uw2"
	}
	fl := "-4"
	if fam == "v6" {
		fl = "-6"
	}
	out, code := run(cmdOpts{Timeout: 15 * time.Second}, "bash", "-c", fmt.Sprintf("printf 'pool-nc-ok\\n' | nc %s %s %s %d", fl, flag, h, port))
	return strings.TrimSpace(out), code
}

func poolPorts() {

	ports := map[string]int{}
	for _, s := range []string{"echo", "echodeny", "pg", "pgdeny", "udpecho", "udpdeny"} {
		p, why := lease(s)
		if p == 0 && strings.Contains(why, "port_quota_exceeded") {
			check("second", "pool", "lease beyond the default project quota (5)", "-", "-", "409 port_quota_exceeded", why, true, "")
			psqlExec("insert into gateway_org_quotas (org_id,max_random_ports,max_random_ports_proj) values ('" + orgID + "',20,20) on conflict (org_id) do update set max_random_ports=20, max_random_ports_proj=20")
			p, why = lease(s)
		}
		if p == 0 {
			check("second", "pool", "POST .../services/"+s+"/port", "-", "-", "lease granted from the pool", why, false, "")
			continue
		}
		ports[s] = p
	}
	// idempotent
	again, _ := lease("echo")
	check("second", "pool", "lease idempotent", "-", "-", "same port on the second request", fmt.Sprintf("%d then %d", ports["echo"], again), again == ports["echo"] && again >= 20000 && again <= 20019, "")
	if ports["echo"] == 0 {
		return
	}
	waitFor(20*time.Second, 300*time.Millisecond, func() bool {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", ports["echo"]), time.Second)
		if err == nil {
			c.Close()
		}
		return err == nil
	})
	time.Sleep(500 * time.Millisecond)
	for _, fam := range []string{"v4", "v6"} {
		h := hostFor(fam)
		// TCP echo, allowed list (Go and nc)
		c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", h, ports["echo"]), 3*time.Second)
		got := ""
		if err == nil {
			c.SetDeadline(time.Now().Add(4 * time.Second))
			c.Write([]byte("pool-tcp-ok"))
			buf := make([]byte, 11)
			n, _ := c.Read(buf)
			got = string(buf[:n])
			c.Close()
		}
		check("second", "pool", "TCP echo through the leased port (Go dial)", fam, "IP list allows", "echo", fmt.Sprintf("%q err=%v", got, err), got == "pool-tcp-ok", "")
		out, code := ncEcho(fam, ports["echo"], false)
		check("second", "pool", "nc -w3 to the leased port", fam, "IP list allows", "pool-nc-ok", fmt.Sprintf("%q exit=%d", out, code), out == "pool-nc-ok", "")
		// denied list
		if p := ports["echodeny"]; p > 0 {
			c, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", h, p), 3*time.Second)
			dgot := "closed"
			if err == nil {
				c.SetDeadline(time.Now().Add(4 * time.Second))
				c.Write([]byte("should-not-echo"))
				buf := make([]byte, 15)
				n, _ := c.Read(buf)
				if n > 0 {
					dgot = "ECHO: " + string(buf[:n])
				}
				c.Close()
			}
			check("second", "pool", "TCP through a leased port, IP not allowed", fam, "IP list denies", "connection closed, no echo", dgot, !strings.HasPrefix(dgot, "ECHO"), "")
		}
		// psql through the leased port
		if p := ports["pg"]; p > 0 {
			host := strings.Trim(h, "[]")
			out, code := run(cmdOpts{Env: cliEnv(""), Timeout: 40 * time.Second}, "psql", fmt.Sprintf("host=%s port=%d sslmode=require user=app dbname=app connect_timeout=15", host, p), "-Atc", rowSQL)
			check("second", "pool", "psql to the leased port of pg", fam, "IP list allows", "interop-row-one", fmt.Sprintf("exit=%d %s", code, trunc(out, 80)), code == 0 && strings.Contains(out, "interop-row-one"), "")
		}
		if p := ports["pgdeny"]; p > 0 {
			host := strings.Trim(h, "[]")
			out, code := run(cmdOpts{Env: cliEnv(""), Timeout: 40 * time.Second}, "psql", fmt.Sprintf("host=%s port=%d sslmode=require user=app dbname=app connect_timeout=15", host, p), "-Atc", rowSQL)
			check("second", "pool", "psql to the leased port of pgdeny", fam, "IP list denies", "fails", fmt.Sprintf("exit=%d %s", code, trunc(out, 80)), code != 0, "")
		}
		// UDP
		if p := ports["udpecho"]; p > 0 {
			out, code := ncEcho(fam, p, true)
			u, err := net.Dial("udp", fmt.Sprintf("%s:%d", h, p))
			ugot := ""
			if err == nil {
				u.SetDeadline(time.Now().Add(4 * time.Second))
				u.Write([]byte("pool-udp-ok"))
				buf := make([]byte, 64)
				n, _ := u.Read(buf)
				ugot = string(buf[:n])
				u.Close()
			}
			check("second", "pool", "UDP echo through the leased port (Go and nc -u)", fam, "IP list allows", "echo", fmt.Sprintf("go=%q nc=%q(exit %d)", ugot, out, code), ugot == "pool-udp-ok" && out == "pool-nc-ok", "")
		}
		if p := ports["udpdeny"]; p > 0 {
			u, err := net.Dial("udp", fmt.Sprintf("%s:%d", h, p))
			ugot := ""
			if err == nil {
				u.SetDeadline(time.Now().Add(3 * time.Second))
				u.Write([]byte("udp-should-not-echo"))
				buf := make([]byte, 64)
				n, _ := u.Read(buf)
				ugot = string(buf[:n])
				u.Close()
			}
			check("second", "pool", "UDP through a leased port, IP not allowed", fam, "IP list denies", "no reply", fmt.Sprintf("reply=%q", ugot), ugot == "", "")
		}
	}
	// release: the port stops answering
	st, _ := api("DELETE", "/services/echo/port", C.CapOK, nil)
	closed := waitFor(15*time.Second, 300*time.Millisecond, func() bool {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", ports["echo"]), time.Second)
		if err != nil {
			return true
		}
		c.SetDeadline(time.Now().Add(2 * time.Second))
		c.Write([]byte("x"))
		b := make([]byte, 1)
		n, _ := c.Read(b)
		c.Close()
		return n == 0
	})
	check("second", "pool", "release of the lease", "v4", "-", "port no longer serves", fmt.Sprintf("DELETE=%d, closed=%v", st, closed), (st == 200 || st == 204) && closed, "existing connections may drain (CAPSULE_GW_POOL_DRAIN)")
	// exhaustion: lease the remaining ports until the pool refuses
	var last string
	n := 0
	for _, name := range []string{"hot", "churn", "idle00", "idle01", "idle02", "idle03", "idle04", "idle05", "idle06", "idle07", "idle08", "idle09", "ssh", "ssh2", "bench", "flaky"} {
		api("PATCH", "/services/"+name, C.CapOK, map[string]any{"gateway_enabled": true})
		p, why := lease(name)
		if p == 0 {
			last = why
			break
		}
		n++
	}
	check("second", "pool", "pool exhaustion (20 ports)", "-", "-", "409 port_pool_exhausted when the range is used up", fmt.Sprintf("%d more leases, then: %s", n, last), strings.Contains(last, "409") || strings.Contains(last, "exhausted") || strings.Contains(last, "quota"), "org/project quotas may answer first")
	api("PATCH", "/services/hot", C.CapOK, map[string]any{"gateway_enabled": false})
	api("PATCH", "/services/churn", C.CapOK, map[string]any{"gateway_enabled": false})
}

// ---- (d) UDP over the capsule/1 tunnel with both libraries ----

func udpTunnel() {
	for _, fam := range []string{"v4", "v6"} {
		pc, err := gw.DialUDP(context.Background(), udpURI("udpecho", fam, false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
		if err != nil {
			check("second", "udp-tunnel", "Go lib DialUDP", fam, "cap_", "opens", err.Error(), false, "")
		} else {
			same := 0
			buf := make([]byte, 4096)
			for i := 0; i < 200; i++ {
				msg := []byte(fmt.Sprintf("udp-dgram-%d-%s", i, strings.Repeat("x", i%200)))
				pc.Write(msg)
				pc.SetReadDeadline(time.Now().Add(3 * time.Second))
				n, e := pc.Read(buf)
				if e == nil && string(buf[:n]) == string(msg) {
					same++
				}
			}
			pc.Close()
			check("second", "udp-tunnel", "Go lib DialUDP", fam, "cap_", "200/200 datagrams echoed intact", fmt.Sprintf("%d/200", same), same == 200, "")
		}
		o, _ := jsRun(map[string]any{"mode": "udp", "uri": udpURI("udpecho", fam, true), "n": 200}, C.CapOK, 120*time.Second)
		check("second", "udp-tunnel", "JS lib connectUdp", fam, "cap_", "200/200 datagrams echoed intact", fmt.Sprintf("%v/200 got=%v %s", o["same"], o["got"], o.s("message")), o.ok() && o.f("same") == 200, "")
		port := freePort()
		stop := startBg(capsuleBin(), cliEnv(C.CapOK), "tunnel", udpURI("udpecho", fam, false), "--listen", fmt.Sprintf("127.0.0.1:%d", port))
		time.Sleep(1500 * time.Millisecond)
		u, err := net.Dial("udp", fmt.Sprintf("127.0.0.1:%d", port))
		got := ""
		if err == nil {
			u.SetDeadline(time.Now().Add(4 * time.Second))
			u.Write([]byte("cli-udp-ok"))
			b := make([]byte, 64)
			n, _ := u.Read(b)
			got = string(b[:n])
			u.Close()
		}
		stop()
		check("second", "udp-tunnel", "capsule tunnel (UDP listener)", fam, "cap_", "echo", fmt.Sprintf("%q", got), got == "cli-udp-ok", "")
	}
	// denied: the same service with an IP list that excludes us
	_, e := gw.DialUDP(context.Background(), udpURI("udpdeny", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	check("second", "udp-tunnel", "Go lib DialUDP, IP not allowed", "v4", "cap_", "IpDenied", errStr(e), errors.Is(e, gw.ErrIpDenied), "")
}
