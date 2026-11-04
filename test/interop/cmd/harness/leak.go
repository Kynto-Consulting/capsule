package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// secrets seen by this run (every token minted or invented, the database password, the shared secrets).
var secrets = map[string]string{}

func noteSecret(kind, v string) {
	if v != "" {
		secrets[v] = kind
	}
}

// phaseLeak: no secret may appear in any log of any component, in the audit trail, nor in anything a client tool printed.
func phaseLeak() {
	fmt.Println("== leak: secrets in logs, audit rows and tool output")
	noteSecret("cap_ token", C.CapOK)
	noteSecret("cap_ token (outsider)", C.CapOther)
	noteSecret("cap_ token (scoped)", C.CapScoped)
	noteSecret("cgs_ token", cgsAll)
	noteSecret("cgs_ token (echo)", cgsEcho)
	noteSecret("database password", "app-pass-1")
	noteSecret("gateway shared secret", C.Secret)
	noteSecret("backend secret key", "interop-secret-key-0123456789abcdef0123")
	noteSecret("signing seed", "interop-signing-seed-0123456789!")

	audit := psqlCtl("select action||' '||coalesce(ip_address::text,'')||' '||coalesce(metadata::text,'') from audit_logs where action like 'gateway.%'")
	files := map[string]string{"audit_logs (gateway.*)": audit}
	for _, n := range []string{"server.log", "gateway.log", "gwnew.log", "gwcache.log", "gwstd.log", "gwnokeys.log"} {
		if b, err := os.ReadFile(filepath.Join(C.W, n)); err == nil {
			files[n] = string(b)
		}
	}
	trMu.Lock()
	files["tool output (stdout+stderr of psql, ssh, capsule, node)"] = transcript.String()
	trMu.Unlock()
	total := 0
	for _, name := range sortedKeys(files) {
		hits := 0
		var which []string
		for s, kind := range secrets {
			if len(s) < 8 {
				continue
			}
			if c := strings.Count(files[name], s); c > 0 {
				hits += c
				which = append(which, kind)
			}
			// the random body of a token on its own (without the prefix)
			if i := strings.Index(s, "_"); i > 0 && len(s)-i > 16 && strings.HasPrefix(s, "c") {
				if c := strings.Count(files[name], s[i+1:i+17]); c > 0 && !strings.Contains(strings.Join(which, ","), kind) {
					hits += c
					which = append(which, kind+" (body)")
				}
			}
		}
		total += hits
		check("leak", "", "secret scan", "-", "-", fmt.Sprintf("%s: 0 occurrences (%d bytes scanned)", name, len(files[name])), fmt.Sprintf("%d occurrences %v", hits, which), hits == 0, "")
	}
	check("leak", "", "secret scan", "-", "-", fmt.Sprintf("%d distinct secrets searched in %d sources", len(secrets), len(files)), fmt.Sprintf("%d occurrences in total", total), total == 0, "gateway ran with CAPSULE_GW_LOG_LEVEL=debug")

	// audit trail content
	rows := psqlCtl("select action, metadata->>'credential_type', coalesce(metadata->>'reason',''), count(*) from audit_logs where action like 'gateway.connect.%' group by 1,2,3 order by 1,2,3")
	allowCap := strings.Contains(rows, "gateway.connect.allow|cap") && strings.Contains(rows, "gateway.connect.allow|cgs") && strings.Contains(rows, "gateway.connect.allow|cgc")
	denyKinds := strings.Contains(rows, "gateway.connect.deny") && strings.Contains(rows, "unauthorized") && strings.Contains(rows, "ip_denied")
	check("leak", "", "audit trail in the database", "-", "-", "allow rows for cap, cgs and cgc; deny rows for unauthorized and ip_denied", strings.ReplaceAll(rows, "\n", " ; "), allowCap && denyKinds, "")
	noIP := psqlCtl("select count(*) from audit_logs where action like 'gateway.connect.%' and (ip_address is null or ip_address::text = '')")
	check("leak", "", "audit trail in the database", "-", "-", "every connection row carries the source IP", "rows without ip: "+noIP, noIP == "0", "")
}
