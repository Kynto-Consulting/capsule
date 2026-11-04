// Command harness is the end-to-end and interoperability test of the Capsule gateway (package G14): the REAL backend, the REAL
// capsule-gateway, the REAL Go library / JS library / capsule CLI, real psql and OpenSSH, all on loopback. See README.md.
package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

func main() {
	initCfg()
	phases := os.Args[1:]
	if len(phases) == 0 || phases[0] == "all" {
		phases = []string{"setup", "codec", "matrix", "interop", "resilience", "second", "bench", "long", "drain", "leak", "accept"}
	}
	start := time.Now()
	startTime = start
	for _, p := range phases {
		fmt.Printf("\n######## %s (t+%s)\n", p, time.Since(start).Round(time.Second))
		switch p {
		case "setup":
			phaseSetup()
		case "codec":
			phaseCodec()
		case "matrix":
			phaseMatrix()
		case "interop":
			phaseInterop()
		case "resilience":
			phaseResilience()
		case "bench":
			phaseBench()
		case "relay":
			phaseRelay()
		case "second":
			phaseSecond()
		case "long":
			phaseLong()
		case "drain":
			phaseDrain()
		case "leak":
			phaseLeak()
		case "accept":
			phaseAccept()
		default:
			fmt.Println("unknown phase", p)
		}
	}
	writeReport()
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
	fmt.Printf("\nTOTAL: %d PASA, %d FALLA, %d N/A in %s\n", pass, fail, na, time.Since(start).Round(time.Second))
	_ = strings.TrimSpace
}

var startTime time.Time
