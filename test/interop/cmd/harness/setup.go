package main

import (
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Services the matrix uses, with the host name of each (read back from the control plane).
var (
	svcHost  = map[string]string{}
	sshKey   string
	cgsAll   string
	cgsEcho  string
	workHome string // empty HOME for CLI runs: no stored session, no config
)

func loadTokens() {
	b, err := os.ReadFile(filepath.Join(C.W, "run", "tokens.env"))
	must(err, "tokens.env")
	for _, l := range strings.Split(string(b), "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(l), "=")
		if !ok {
			continue
		}
		switch k {
		case "CAP_OK":
			C.CapOK = v
		case "CAP_OTHER":
			C.CapOther = v
		case "CAP_SCOPED":
			C.CapScoped = v
		}
	}
}

func initCfg() {
	C.W = envOr("W", "/tmp/capsule-interop")
	exe, _ := os.Executable()
	C.Bin = filepath.Dir(exe)
	C.Dir = filepath.Dir(C.Bin)
	C.GW = 18443
	C.Secret = "interop-gw-secret-do-not-use"
	C.API = fmt.Sprintf("/api/v1/orgs/%s/projects/%s/gateway", orgID, projID)
	C.API = "http://localhost:18080" + C.API
	loadTokens()
	pem, err := os.ReadFile(filepath.Join(C.W, "certs", "ca.crt"))
	must(err, "ca.crt")
	C.CAPem = pem
	C.CA = x509.NewCertPool()
	C.CA.AppendCertsFromPEM(pem)
	must(os.MkdirAll(filepath.Join(C.Dir, ".run"), 0o755), "mkdir .run")
	must(os.WriteFile(filepath.Join(C.Dir, ".run", "ca.crt"), pem, 0o644), "copy ca")
	w, _ := sh("wslpath -w '" + filepath.Join(C.Dir, ".run", "ca.crt") + "'")
	C.CAWin = strings.TrimSpace(w)
	ip, _ := sh("hostname -I | cut -d' ' -f1")
	C.WslIP = strings.TrimSpace(ip)
	workHome = filepath.Join(C.W, "home")
	os.MkdirAll(workHome, 0o755)
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func phaseSetup() {
	fmt.Println("== setup: services, tokens, destination servers, gateway")
	var err error
	sshKey, err = makeSSHKey(filepath.Join(C.W, "run"))
	must(err, "ssh key")
	must(startTargets(), "targets")

	// the control plane mirrors the seeded database and ports as services; enable the gateway access of each
	st, b := api("GET", "/services", C.CapOK, nil)
	if st != 200 {
		must(fmt.Errorf("list services: %d %s", st, trunc(string(b), 200)), "services")
	}
	var list struct {
		Services []struct {
			Name     string `json:"name"`
			Host     string `json:"host"`
			Protocol string `json:"protocol"`
		} `json:"services"`
	}
	must(json.Unmarshal(b, &list), "services json")
	for _, s := range list.Services {
		svcHost[s.Name] = s.Host
		if s.Name == "hot" || s.Name == "churn" {
			continue // enabled during the hot-route test
		}
		body := map[string]any{"gateway_enabled": true}
		if st, b := api("PATCH", "/services/"+s.Name, C.CapOK, body); st != 200 {
			must(fmt.Errorf("enable %s: %d %s", s.Name, st, trunc(string(b), 200)), "enable service")
		}
		if strings.HasPrefix(s.Name, "ssh") {
			if st, b := api("PATCH", "/services/"+s.Name, C.CapOK, map[string]any{"mode": "terminate"}); st != 200 {
				must(fmt.Errorf("terminate %s: %d %s", s.Name, st, trunc(string(b), 200)), "ssh mode")
			}
		}
	}
	fmt.Printf("services: %d (hosts: pg=%s ssh=%s)\n", len(list.Services), svcHost["pg"], svcHost["ssh"])

	// service tokens: one for the whole project, one restricted to echo
	cgsAll = mkSvcToken("all", "")
	cgsEcho = mkSvcToken("echo-only", "echo")

	out, code := gwctl("start")
	must(func() error {
		if code != 0 {
			return fmt.Errorf("gateway start: %s", out)
		}
		return nil
	}(), "gateway")
	fmt.Println("gateway:", strings.TrimSpace(out))
	if !waitFor(10*time.Second, 200*time.Millisecond, func() bool {
		_, body := adminGet("127.0.0.1:19102", "/readyz")
		return strings.Contains(body, "ready") || strings.Contains(body, "ok")
	}) {
		fmt.Println("warning: /readyz body unexpected")
	}
}

func mkSvcToken(name, svc string) string {
	body := map[string]any{"name": "interop-" + name}
	if svc != "" {
		body["service"] = svc
	}
	st, b := api("POST", "/service-tokens", C.CapOK, body)
	if st != 201 {
		must(fmt.Errorf("service token: %d %s", st, trunc(string(b), 200)), "cgs")
	}
	var r struct {
		Token string `json:"token"`
	}
	json.Unmarshal(b, &r)
	return r.Token
}

func mintCGC(svc string) string {
	st, b := api("POST", "/services/"+svc+"/connection-token", C.CapOK, map[string]any{})
	if st != 200 && st != 201 {
		return ""
	}
	var r struct {
		Token string `json:"token"`
	}
	json.Unmarshal(b, &r)
	noteSecret("cgc_ token", r.Token)
	return r.Token
}

// ---- addressing ----

func gwAddr(fam string, js bool) string {
	if fam == "v6" {
		return fmt.Sprintf("[::1]:%d", C.GW)
	}
	if js {
		return fmt.Sprintf("%s:%d", C.WslIP, C.GW)
	}
	return fmt.Sprintf("127.0.0.1:%d", C.GW)
}

func capURI(project, svc, fam string, js bool) string {
	q := url.Values{}
	q.Set("gateway", gwAddr(fam, js))
	q.Set("sni", "tcp.interop.test")
	enc := strings.ReplaceAll(strings.ReplaceAll(q.Encode(), "%5B", "%5B"), "%5D", "%5D")
	return fmt.Sprintf("capsule://%s/%s?%s", project, svc, enc)
}
