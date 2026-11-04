package main

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// Diagnostic for the JS-over-::1 runs: does the Windows<->WSL localhost relay itself break a half-closed 5 MB echo?
// (No gateway, no TLS: a plain echo server on [::]:55600 and 0.0.0.0:55601, a plain node.exe client.)

var relayBreaksHalfClose bool
var relayChecked bool

func relayProbe(host, port string, runs int, timeout time.Duration) (bad int, last string) {
	for i := 0; i < runs; i++ {
		out, _ := run(cmdOpts{Timeout: timeout}, nodeExe, winDir()+`\js\rawecho.mjs`, host, port, "5")
		last = strings.TrimSpace(lastLine(out))
		if !strings.Contains(last, `"ok":true`) {
			bad++
		}
	}
	return
}

func relayServers() func() {
	l6, err := net.Listen("tcp", "[::]:55600")
	if err != nil {
		return func() {}
	}
	l4, _ := net.Listen("tcp", "0.0.0.0:55601")
	for _, l := range []net.Listener{l6, l4} {
		go func(l net.Listener) {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				go echoConn(c)
			}
		}(l)
	}
	time.Sleep(3 * time.Second) // let the relay notice the listeners
	return func() { l6.Close(); if l4 != nil { l4.Close() } }
}

func detectRelay() {
	if relayChecked {
		return
	}
	relayChecked = true
	stop := relayServers()
	defer stop()
	bad, last := relayProbe("::1", "55600", 1, 15*time.Second)
	relayBreaksHalfClose = bad > 0
	bad4, last4 := relayProbe(C.WslIP, "55601", 2, 15*time.Second)
	check("relay", "", "plain TCP 5 MB half-close echo, node.exe", "::1 (relay)", "-", "completes (diagnostic of the test environment)", fmt.Sprintf("%d of 1 truncated; %s", bad, last), true,
		map[bool]string{true: "the Windows<->WSL relay itself breaks half-close on ::1: JS-over-::1 runs with half-close are not attributable to the gateway or the library", false: "relay forwards half-close"}[relayBreaksHalfClose])
	check("relay", "", "plain TCP 5 MB half-close echo, node.exe", "WSL address", "-", "completes", fmt.Sprintf("%d of 2 truncated; %s", bad4, last4), bad4 == 0, "")
}

func phaseRelay() { detectRelay() }
