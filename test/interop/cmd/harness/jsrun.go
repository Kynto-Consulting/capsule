package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// The JS library runs under the Windows node.exe launched from WSL (WSL has no node). The gateway is reached over the WSL
// virtual NIC for IPv4 (the interop relay does not forward the IPv4 loopback when an IPv6 wildcard socket shares the port)
// and over ::1 for IPv6 (relayed to the gateway's [::] socket).

const nodeExe = "/mnt/c/Program Files/nodejs/node.exe"

var winDirCache string

func winDir() string {
	if winDirCache == "" {
		o, _ := sh("wslpath -w '" + C.Dir + "'")
		winDirCache = strings.TrimSpace(o)
	}
	return winDirCache
}

type jsOut map[string]any

func (j jsOut) s(k string) string {
	if v, ok := j[k]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
		b, _ := json.Marshal(v)
		return string(b)
	}
	return ""
}

func (j jsOut) f(k string) float64 {
	if v, ok := j[k].(float64); ok {
		return v
	}
	return 0
}

func (j jsOut) ok() bool { v, _ := j["ok"].(bool); return v }

// jsRun executes client.mjs with args. The token travels in the environment (WSLENV), not on the command line.
func jsRun(args map[string]any, token string, timeout time.Duration) (jsOut, string) {
	args["ca"] = C.CAWin
	args["pgca"] = C.CAWin
	b, _ := json.Marshal(args)
	env := append(os.Environ(), "GWTOKEN="+token, "WSLENV=GWTOKEN")
	out, code := run(cmdOpts{Env: env, Timeout: timeout}, nodeExe, winDir()+`\js\client.mjs`, base64.StdEncoding.EncodeToString(b))
	line := ""
	for _, l := range strings.Split(out, "\n") {
		if l = strings.TrimSpace(l); strings.HasPrefix(l, "{") {
			line = l
		}
	}
	var o jsOut
	if line == "" || json.Unmarshal([]byte(line), &o) != nil {
		return jsOut{"ok": false, "message": "no JSON from node (exit " + itoa(code) + "): " + trunc(out, 200)}, out
	}
	return o, out
}

func itoa(n int) string { return fmt.Sprint(n) }
