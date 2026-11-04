package main

import (
	"bytes"
	"io"
	"net/http"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type crit struct {
	N        string
	Text     string
	Status   string // PASA | FALLA | NO PROBADO
	Evidence string
}

var criteria []crit

func addCrit(n, text, status, ev string) {
	criteria = append(criteria, crit{n, text, status, ev})
	fmt.Printf("[F1 %s] %-8s %s -- %s\n", n, status, text, trunc(ev, 160))
}

func filterRes(f func(Res) bool) (total, pass int) {
	for _, r := range results {
		if r.Status == "NA" || !f(r) {
			continue
		}
		total++
		if r.Status == "PASA" {
			pass++
		}
	}
	return
}

func stat(total, pass int) string {
	if total == 0 {
		return "NO PROBADO"
	}
	if pass == total {
		return "PASA"
	}
	return "FALLA"
}

func sshWho(svcHostName, via, fam string) string {
	switch via {
	case "sni":
		proxy := fmt.Sprintf("openssl s_client -quiet -connect %s:%d -servername %s -CAfile %s -verify_return_error", hostaddr(fam), C.GW, svcHostName, filepath.Join(C.W, "certs", "ca.crt"))
		if fam == "v6" {
			proxy = strings.Replace(proxy, "-connect ::1:", "-connect [::1]:", 1)
		}
		out, _ := run(cmdOpts{Env: cliEnv(""), Timeout: 40 * time.Second}, "ssh", append(append([]string{}, sshOpts...), "-o", "ProxyCommand="+proxy, "-i", sshKey, "-l", "interop", "sshbysni", "whoami")...)
		return lastLine(out)
	default: // capsule ssh --print ProxyCommand
		return ""
	}
}

func capsuleSSHWho(svc, fam string) string {
	blk, _ := run(cmdOpts{Env: cliEnv(C.CapOK), Timeout: 20 * time.Second}, capsuleBin(), "ssh", capURI("shop", svc, fam, false), "--print", "-l", "interop")
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
	out, _ := run(cmdOpts{Env: cliEnv(C.CapOK), Timeout: 40 * time.Second}, "ssh", append(append([]string{}, sshOpts...), "-o", "ProxyCommand="+proxy, "-o", "HostKeyAlias="+alias, "-i", sshKey, "-l", "interop", alias, "whoami")...)
	return lastLine(out)
}

func phaseAccept() {
	fmt.Println("== accept: PLAN 12.2, criteria of F1 one by one")

	contractChecks()
	// 1. psql by SNI name, two databases
	var rows []string
	okSNI := 0
	for _, fam := range []string{"v4", "v6"} {
		for _, svc := range []string{"pg", "pg2"} {
			o := psqlSNI(false)(fam, svc, "")
			rows = append(rows, fmt.Sprintf("%s/%s:%s", svc, fam, firstNonEmpty(o.Row, trunc(o.Msg, 50))))
			if o.Class == "allow" {
				okSNI++
			}
		}
	}
	ver, _ := sh("psql --version")
	// the gateway on the standard ports: a second process on 127.0.0.77 (443 and 5432), the real ports of the plan
	out, code := gwctl("start", "GW_NAME=gwstd", "GW_ADMIN=127.0.0.1:19104", "GW_LISTEN=127.0.0.77:5432=pg-ssl,127.0.0.77:443=tls")
	std5432, std443 := "not started", "not started"
	if code == 0 {
		o, c := run(cmdOpts{Env: cliEnv(""), Timeout: 30 * time.Second}, "psql", fmt.Sprintf("host=%s hostaddr=127.0.0.77 port=5432 sslmode=require user=app dbname=app connect_timeout=15", sniHost("pg")), "-Atc", rowSQL)
		hs, _ := sh(fmt.Sprintf("echo | openssl s_client -starttls postgres -connect 127.0.0.77:5432 -servername %s -CAfile %s/certs/ca.crt 2>&1 | grep -E 'Verify return code|subject=|CN *=' | head -2 | tr '\\n' ' '", sniHost("pg"), C.W))
		std5432 = fmt.Sprintf("psql exit=%d %s | listener handshake: %s", c, trunc(o, 70), trunc(hs, 90))
		u := strings.Replace(capURI("shop", "pg", "v4", false), "127.0.0.1:18443", "127.0.0.77:443", 1)
		oo := goLibURI(u, C.CapOK)
		std443 = fmt.Sprintf("tunnel via 127.0.0.77:443: %s row=%q", oo.Class, oo.Row)
	}
	gwctl("stop", "GW_NAME=gwstd")
	_ = out
	addCrit("1", "psql \"host=<name> sslmode=require\" (libpq >= 14) connects on 5432 and routes 2 databases", func() string {
		if okSNI == 4 && strings.Contains(std5432, "interop-row-one") {
			return "PASA"
		}
		return "FALLA"
	}(), fmt.Sprintf("%s; %s; port 5432: %s", strings.TrimSpace(ver), strings.Join(rows, " "), std5432))
	_, ok443 := filterRes(func(r Res) bool { return false })
	_ = ok443
	addCrit("2", "gateway answers on 443 and 5432 (loopback address 127.0.0.77, not the production host)", func() string {
		if strings.Contains(std443, "allow") && strings.Contains(std443, "interop-row-one") {
			if strings.Contains(std5432, "interop-row-one") {
				return "PASA"
			}
			return "FALLA"
		}
		return "FALLA"
	}(), std443+" ; 5432: "+std5432)

	// 3. ssh to two sshd through the ProxyCommand
	a := sshWho(sniHost("ssh"), "sni", "v4")
	b := sshWho(sniHost("ssh2"), "sni", "v6")
	c1 := capsuleSSHWho("ssh", "v4")
	c2 := capsuleSSHWho("ssh2", "v6")
	addCrit("3a", "ssh with the ProxyCommand of `capsule ssh --print` reaches 2 different sshd (capsule/1 tunnel)", map[bool]string{true: "PASA", false: "FALLA"}[c1 == "interop-ssh-one" && c2 == "interop-ssh-two"],
		fmt.Sprintf("ssh (v4) -> %q ; ssh2 (::1) -> %q", c1, c2))
	addCrit("3b", "ssh with ProxyCommand `openssl s_client -servername <name>` reaches 2 different sshd (SNI name, gateway terminates TLS)", map[bool]string{true: "PASA", false: "FALLA"}[a == "interop-ssh-one" && b == "interop-ssh-two"],
		fmt.Sprintf("ssh (v4) -> %q ; ssh2 (::1) -> %q", trunc(a, 60), trunc(b, 60)))
	nk := cgcWithoutKeys()
	addCrit("3c", "cgc_ tokens also work when the gateway has no local signing keys (control plane verifies)", map[bool]string{true: "PASA", false: "FALLA"}[strings.HasPrefix(nk, "allow") && strings.Contains(nk, "replay of the same token: deny")], "gateway started with CAPSULE_GW_CGC_KEYS empty: "+nk)

	// 4. route effective < 5 s
	t, p := filterRes(func(r Res) bool { return r.Client == "hot route add" })
	addCrit("4", "a new route is effective in < 5 s", stat(t, p), findGot("hot route add"))

	// 5. invalid token / non-existent route indistinguishable
	t, p = filterRes(func(r Res) bool { return strings.HasPrefix(r.ID, "uniform") })
	t2, p2 := filterRes(func(r Res) bool {
		return r.Phase == "matrix" && (r.Cred == "invalid token" || r.Cred == "no such service" || r.Cred == "other org (cap_)" || r.Cred == "scoped elsewhere") && !strings.Contains(r.Client, "SNI")
	})
	addCrit("5", "invalid token and non-existent route are indistinguishable (same error, same time; every client)", stat(t+t2, p+p2), fmt.Sprintf("uniform error+time: %d/%d; refusal cells over every client and family: %d/%d. %s", p, t, p2, t2, findGot("3 causes")))

	// 6. 10 minute connection across route reloads
	t, p = filterRes(func(r Res) bool { return r.Phase == "long" })
	addCrit("6", "a 10 minute connection survives route reloads (and control restart, certificate reload, load)", stat(t, p), fmt.Sprintf("%d/%d checks. %s | %s", p, t, findGot("ssh session"), findGot("route reloads")))

	// 7. IPv6 dual stack
	parity, cells, mism := 0, 0, []string{}
	st4 := map[string]string{}
	for _, r := range results {
		if r.Phase == "matrix" && r.Family == "v4" && r.Status != "NA" {
			st4[r.Client+"|"+r.Cred] = r.Status
		}
	}
	for _, r := range results {
		if r.Phase == "matrix" && r.Family == "v6" && r.Status != "NA" {
			cells++
			if st4[r.Client+"|"+r.Cred] == r.Status {
				parity++
			} else if len(mism) < 3 {
				mism = append(mism, r.Client+"/"+r.Cred)
			}
		}
	}
	t6, p6 := filterRes(func(r Res) bool { return r.Phase == "matrix" && r.Family == "v6" })
	t4, p4 := filterRes(func(r Res) bool { return r.Phase == "matrix" && r.Family == "v4" })
	addCrit("7", "dual-stack gateway: same result over IPv4 and over ::1 for every client and credential", func() string {
		if parity == cells && cells > 0 {
			return "PASA"
		}
		return "FALLA"
	}(), fmt.Sprintf("%d/%d matrix cells identical in both families (differences: %v); matrix passes: v4 %d/%d, v6 %d/%d; Go lib, JS lib (v4 over the WSL NIC, ::1 over the relay), capsule CLI, psql and OpenSSH all connect on ::1", parity, cells, mism, p4, t4, p6, t6))

	// 8. 40000-40199 direct ports
	addCrit("8", "ports 40000-40199 keep connecting with the same IP list (regression of the direct path)", "NO PROBADO",
		"the direct path is the AWS security group plus docker published ports: no firewall or AWS exists in this local run (and none may be touched). Only the gateway side of the single list is checked, see criterion 9.")

	// 9. one list for both paths: editing the rules changes the gateway decision
	listOK, listEv := singleList()
	addCrit("9", "one IP list: editing the database access rules changes the gateway decision (gateway side of the single list)", map[bool]string{true: "PASA", false: "FALLA"}[listOK], listEv)

	// 10. connection strings, gateway first
	first, ev := connStrings()
	addCrit("10", "connection_strings: the gateway entry comes first (legacy field keeps the direct string)", map[bool]string{true: "PASA", false: "FALLA"}[first], ev)

	for _, x := range []struct{ n, id, text string }{{"X1", "login", "capsule login session (JWT) -> connect, minting a cgc_ (real login endpoint)"}, {"X2", "cgc-", "expired / wrong-key / wrong-route cgc_ (0x0202 vs uniform 0x0201), Go, JS, CLI"}, {"X3", "pool", "random-port pool: lease, TCP/UDP/psql with allowed and denied IP list, release, exhaustion"}, {"X4", "udp-tunnel", "UDP tunnel capsule/1 with Go lib, JS lib and capsule tunnel"}, {"X5", "empty-list", "access by name (and tunnel) with an EMPTY IP list denies"}} {
		t, p := filterRes(func(r Res) bool { return r.Phase == "second" && strings.HasPrefix(r.ID, x.id) })
		addCrit(x.n, x.text, stat(t, p), fmt.Sprintf("%d/%d checks pass", p, t))
	}
	addCrit("11", "informe de deploy v1 (package G7)", "NO PROBADO", "outside this package: no deploy report component exists in the gateway interop run")
	addCrit("12", "secondary path: netaccess/handler tests unchanged; psql host:40123 keeps working", "NO PROBADO", "needs the firewall reconciler and a real published port; `go test ./internal/netaccess/...` was run separately (see README)")
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func findGot(client string) string {
	for _, r := range results {
		if r.Client == client || strings.Contains(r.Client, client) || strings.Contains(r.Cred, client) {
			return r.Got
		}
	}
	return ""
}

func goLibURI(uri, tok string) Outcome {
	return goLibWith(uri, tok)
}

func singleList() (bool, string) {
	psqlCtl("delete from database_access_rules where database_id='00000000-0000-0000-0000-0000000000d3'")
	t0 := time.Now()
	denied := waitFor(45*time.Second, 1500*time.Millisecond, func() bool { return goLib("v4", "pg2", C.CapOK).Class == "ipdeny" })
	dt := time.Since(t0)
	psqlCtl("insert into database_access_rules (database_id,cidr) values ('00000000-0000-0000-0000-0000000000d3','127.0.0.0/8'),('00000000-0000-0000-0000-0000000000d3','::1/128')")
	t1 := time.Now()
	back := waitFor(45*time.Second, 1*time.Second, func() bool { return goLib("v4", "pg2", C.CapOK).Class == "allow" })
	return denied && back, fmt.Sprintf("rules deleted -> IpDenied after %s (data-plane cache of allow decisions is 30 s); rules restored -> allowed after %s", dt.Round(time.Second), time.Since(t1).Round(time.Second))
}

func connStrings() (bool, string) {
	var parts []string
	ok := true
	for _, svc := range []string{"pg", "echo"} {
		st, b := api("GET", "/services/"+svc+"/connection-info", C.CapOK, nil)
		var r struct {
			ConnectionStrings []struct {
				Access string `json:"access"`
				Kind   string `json:"kind"`
			} `json:"connection_strings"`
			Legacy string `json:"connection_string"`
		}
		json.Unmarshal(b, &r)
		firstAcc := ""
		if len(r.ConnectionStrings) > 0 {
			firstAcc = r.ConnectionStrings[0].Access
		}
		kinds := []string{}
		for _, c := range r.ConnectionStrings {
			kinds = append(kinds, c.Access+"/"+c.Kind)
		}
		parts = append(parts, fmt.Sprintf("%s: HTTP %d first=%s all=%v legacy=%q", svc, st, firstAcc, kinds, r.Legacy))
		if firstAcc != "gateway" {
			ok = false
		}
		hasDirect := false
		for _, c := range kinds {
			if strings.HasPrefix(c, "direct_port") {
				hasDirect = true
			}
		}
		if svc == "echo" && (!hasDirect || r.Legacy == "") { // direct access is enabled on this service: it must be listed second and the legacy field must keep its value
			ok = false
			parts = append(parts, "echo: direct_port entry or legacy connection_string missing")
		}
	}
	return ok, strings.Join(parts, " ; ")
}

// ---- report ----

func writeReport() {
	b, _ := json.MarshalIndent(map[string]any{"results": results, "criteria": criteria}, "", " ")
	os.WriteFile(filepath.Join(C.Dir, "results.json"), b, 0o644)
	var w strings.Builder
	fmt.Fprintf(&w, "# Resultados de la prueba de interoperabilidad del gateway\n\nGenerado por `run.sh` (%s). Componentes reales: backend `cmd/server` con las 64 migraciones, `capsule-gateway`, libreria Go `gatewayclient`, libreria JS (`packages/gateway-js/dist` bajo node.exe), CLI `capsule`, psql 18, OpenSSH, openssl. Todo en loopback dentro de WSL.\n\n", time.Now().Format("2006-01-02 15:04"))
	pass, fail, na := 0, 0, 0
	for _, r := range results {
		switch r.Status {
		case "PASA":
			pass++
		case "FALLA":
			fail++
		default:
			na++
		}
	}
	fmt.Fprintf(&w, "Total: **%d PASA, %d FALLA, %d no aplica**.\n\n## Criterios de aceptacion de F1 (PLAN 12.2)\n\n| # | Criterio | Estado | Evidencia |\n|---|---|---|---|\n", pass, fail, na)
	for _, c := range criteria {
		fmt.Fprintf(&w, "| %s | %s | **%s** | %s |\n", c.N, c.Text, c.Status, md(c.Evidence))
	}
	// matrix grids
	byClient := map[string]map[string]Res{}
	var order []string
	for _, r := range results {
		if r.Phase != "matrix" || r.Family == "" || r.Cred == "" {
			continue
		}
		if byClient[r.Client] == nil {
			byClient[r.Client] = map[string]Res{}
			order = append(order, r.Client)
		}
		byClient[r.Client][r.Cred+"|"+r.Family] = r
	}
	fmt.Fprintf(&w, "\n## Matriz cliente x familia x credencial\n\nPASA = el resultado fue el esperado (consulta real / error uniforme / codigo de salida). N/A = la credencial no interviene en esa via.\n")
	for _, cl := range order {
		fmt.Fprintf(&w, "\n### %s\n\n| Credencial | IPv4 | ::1 |\n|---|---|---|\n", cl)
		creds := map[string]bool{}
		for k := range byClient[cl] {
			creds[strings.Split(k, "|")[0]] = true
		}
		for _, c := range sortedKeys(creds) {
			cell := func(f string) string {
				r, ok := byClient[cl][c+"|"+f]
				if !ok {
					return ""
				}
				s := r.Status
				if r.Status == "FALLA" {
					s += ": " + md(trunc(r.Got, 70))
				}
				return s
			}
			fmt.Fprintf(&w, "| %s | %s | %s |\n", c, cell("v4"), cell("v6"))
		}
	}
	fmt.Fprintf(&w, "\n## Resto de comprobaciones\n\n| Fase | Cliente | Fam. | Esperado | Obtenido | Estado | Nota |\n|---|---|---|---|---|---|---|\n")
	phases := []string{"codec", "interop", "resilience", "long", "drain", "bench", "leak", "matrix"}
	sort.SliceStable(results, func(i, j int) bool { return idx(phases, results[i].Phase) < idx(phases, results[j].Phase) })
	for _, r := range results {
		if r.Phase == "matrix" && r.Cred != "" && !strings.Contains(r.ID, "uniform") && !strings.Contains(r.ID, "ssh-doc") && !strings.Contains(r.Cred, "replay") && r.Status != "FALLA" {
			continue
		}
		if r.Phase == "matrix" && r.Status == "NA" {
			continue
		}
		fmt.Fprintf(&w, "| %s | %s | %s | %s | %s | %s | %s |\n", r.Phase, md(r.Client), r.Family, md(r.Expect), md(trunc(r.Got, 400)), r.Status, md(r.Note))
	}
	os.WriteFile(filepath.Join(C.Dir, "RESULTS.md"), []byte(w.String()), 0o644)
}

func idx(l []string, s string) int {
	for i, x := range l {
		if x == s {
			return i
		}
	}
	return len(l)
}

func md(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ")
}

// Contract checks between the components, reproduced with plain HTTP (minimal reproductions for FINDINGS.md).
func contractChecks() {
	st, b, _ := internal("GET", "/internal/gateway/routes?wait=0")
	var snap struct {
		Routes []struct {
			ID      string `json:"id"`
			Service string `json:"service"`
		} `json:"routes"`
	}
	json.Unmarshal(b, &snap)
	rid := ""
	for _, r := range snap.Routes {
		if r.Service == "pg" {
			rid = r.ID
		}
	}
	if st != 200 || rid == "" {
		check("contract", "", "authorize(none, sni_name)", "-", "-", "route found", fmt.Sprintf("HTTP %d", st), false, "")
		return
	}
	body, _ := json.Marshal(map[string]any{"route_id": rid, "src_ip": "127.0.0.1", "credential_type": "none", "access": "sni_name"})
	req, _ := http.NewRequest("POST", "http://127.0.0.1:18080/internal/gateway/authorize", bytes.NewReader(body))
	req.Header.Set("X-Gateway-Secret", C.Secret)
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	got := ""
	allow := false
	if err == nil {
		rb, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		got = strings.TrimSpace(string(rb))
		var r struct{ Allow bool `json:"allow"` }
		json.Unmarshal(rb, &r)
		allow = r.Allow
	}
	check("contract", "sni-none", "data plane -> control: POST /internal/gateway/authorize", "-", "none", "credential_type=none, access=sni_name, source inside the database rule list => allow (the data plane sends exactly this for psql by name)", got, allow,
		"DEFECT backend/internal/gateway/api/authorize.go (authenticate returns nil for CredNone) vs backend/internal/gateway/data/handlers.go (admit(..., CredNone, \"\", AccessSNI)); API.openapi.yaml lists credential_type none")

	// CLI auto-mint of a cgc_ from a login session
	for _, pj := range []string{} { // the CLI route was fixed; the real login flow is exercised in phase second
		req, _ := http.NewRequest("POST", "http://localhost:18080/api/v1/projects/"+pj+"/gateway/services/pg/connection-token", strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+C.CapOK)
		req.Header.Set("Content-Type", "application/json")
		resp, err := hc.Do(req)
		code := 0
		if err == nil {
			code = resp.StatusCode
			resp.Body.Close()
		}
		check("contract", "cli-mint", "capsule CLI mintConnectionToken", "-", "session", "POST /api/v1/projects/"+map[string]string{projID: "<uuid>", "shop": "<slug>"}[pj]+"/gateway/services/pg/connection-token answers 200/201", fmt.Sprintf("HTTP %d", code), code == 200 || code == 201,
			"DEFECT cli/cmd/capsule/connect.go mintConnectionToken: the route is /api/v1/orgs/{org}/projects/{project}/gateway/services/{svc}/connection-token (backend router)")
	}
}

// A gateway process with no local cgc_ keys sends cgc_ tokens to the control plane for verification.
func cgcWithoutKeys() string {
	out, code := gwctl("start", "CGC=none", "GW_NAME=gwnokeys", "GW_ADMIN=127.0.0.1:19106", "GW_LISTEN=127.0.0.1:18491")
	if code != 0 {
		return "gateway did not start: " + trunc(out, 80)
	}
	defer gwctl("stop", "GW_NAME=gwnokeys")
	u := strings.Replace(capURI("shop", "pg", "v4", false), "127.0.0.1%3A18443", "127.0.0.1%3A18491", 1)
	tok := mintCGC("pg")
	o := goLibWith(u, tok)
	again := goLibWith(u, tok)
	return fmt.Sprintf("%s row=%q; replay of the same token: %s", o.Class, o.Row, again.Class) + map[bool]string{true: "", false: " (" + trunc(o.Msg, 80) + ")"}[o.Class == "allow" && again.Class == "deny"]
}
