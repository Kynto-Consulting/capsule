package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	gw "github.com/kynto-consulting/capsule/cli/pkg/gatewayclient"
)

// Short measurements with the real components (loopback: they do not predict a real network).

func pingLat(c net.Conn, n int) (p50, p99 float64) {
	lat := make([]float64, 0, n)
	b := []byte{1}
	r := make([]byte, 1)
	for i := 0; i < n; i++ {
		t := time.Now()
		c.Write(b)
		if _, err := io.ReadFull(c, r); err != nil {
			break
		}
		lat = append(lat, float64(time.Since(t).Nanoseconds())/1000)
	}
	sort.Float64s(lat)
	if len(lat) == 0 {
		return 0, 0
	}
	return lat[len(lat)/2], lat[len(lat)*99/100]
}

func benchHdr(mode byte, n int64) []byte {
	h := make([]byte, 9)
	h[0] = mode
	binary.BigEndian.PutUint64(h[1:], uint64(n))
	return h
}

func mbps(n int64, d time.Duration) float64 { return float64(n) / 1e6 / d.Seconds() }

func phaseBench() {
	fmt.Println("== bench: latency and throughput, tunnel vs direct, then idle connections")
	const pings = 4000
	d, err := net.Dial("tcp", "127.0.0.1:55407")
	if err != nil {
		check("bench", "", "direct", "v4", "-", "dial echo", err.Error(), false, "")
		return
	}
	dp50, dp99 := pingLat(d, pings)
	d.Close()
	tc, err := gw.Dial(context.Background(), capURI("shop", "echo", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	if err != nil {
		check("bench", "", "tunnel", "v4", "-", "dial", err.Error(), false, "")
		return
	}
	tp50, tp99 := pingLat(tc, pings)
	tc.Close()
	tc6, err := gw.Dial(context.Background(), capURI("shop", "echo", "v6", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	var t6p50, t6p99 float64
	if err == nil {
		t6p50, t6p99 = pingLat(tc6, pings)
		tc6.Close()
	}
	js, _ := jsRun(map[string]any{"mode": "ping", "uri": capURI("shop", "echo", "v6", true), "n": 1500}, C.CapOK, 60*time.Second)
	check("bench", "", "latency 1-byte ping-pong", "v4", "cap_", fmt.Sprintf("p50/p99 over %d round trips", pings),
		fmt.Sprintf("direct TCP %.0f/%.0f us; tunnel (Go lib) %.0f/%.0f us; tunnel over ::1 %.0f/%.0f us; JS lib over ::1 (node.exe via WSL relay) %.0f/%.0f us", dp50, dp99, tp50, tp99, t6p50, t6p99, js.f("p50us"), js.f("p99us")), tp50 > 0 && dp50 > 0, "loopback; informational")

	const G = int64(1) << 30
	// download 1 GB
	dc, _ := net.Dial("tcp", "127.0.0.1:55409")
	dc.Write(benchHdr('D', G))
	t0 := time.Now()
	n1, _ := io.Copy(io.Discard, dc)
	dd := time.Since(t0)
	dc.Close()
	tcn, err := gw.Dial(context.Background(), capURI("shop", "bench", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	var n2 int64
	var td time.Duration
	if err == nil {
		tcn.Write(benchHdr('D', G))
		t0 = time.Now()
		n2, _ = io.Copy(io.Discard, tcn)
		td = time.Since(t0)
		tcn.Close()
	}
	// upload 1 GB
	uc, _ := net.Dial("tcp", "127.0.0.1:55409")
	uc.Write(benchHdr('U', G))
	buf := make([]byte, 1<<20)
	t0 = time.Now()
	for left := G; left > 0; left -= int64(len(buf)) {
		uc.Write(buf)
	}
	ack := make([]byte, 8)
	io.ReadFull(uc, ack)
	ud := time.Since(t0)
	uc.Close()
	tcu, err := gw.Dial(context.Background(), capURI("shop", "bench", "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry()})
	var tud time.Duration
	var tack uint64
	if err == nil {
		tcu.Write(benchHdr('U', G))
		t0 = time.Now()
		for left := G; left > 0; left -= int64(len(buf)) {
			tcu.Write(buf)
		}
		a := make([]byte, 8)
		io.ReadFull(tcu, a)
		tack = binary.BigEndian.Uint64(a)
		tud = time.Since(t0)
		tcu.Close()
	}
	// 1 GB through capsule connect (Go lib inside the CLI plus a local hop)
	cliMB := cliDown(G)
	check("bench", "", "throughput 1 GiB", "v4", "cap_", "download and upload through the tunnel vs direct (exact byte counts)",
		fmt.Sprintf("download: direct %.0f MB/s, tunnel %.0f MB/s, capsule connect %.0f MB/s; upload: direct %.0f MB/s, tunnel %.0f MB/s", mbps(n1, dd), mbps(n2, td), cliMB, mbps(G, ud), mbps(int64(tack), tud)),
		n1 == G && n2 == G && tack == uint64(G) && td > 0, "loopback, one stream, informational (PLAN prototype: direct 3174 MB/s, tunnel 632 MB/s)")

	idleConns()
}

func cliDown(n int64) float64 {
	port := freePort()
	cmdDone := make(chan struct{})
	_ = cmdDone
	pid := startBg(capsuleBin(), cliEnv(cgsAll), "connect", capURI("shop", "bench", "v4", false), "--listen", fmt.Sprintf("127.0.0.1:%d", port))
	defer pid()
	if !waitFor(5*time.Second, 50*time.Millisecond, func() bool { l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); if err == nil { l.Close(); return false }; return true }) {
		return 0
	}
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return 0
	}
	defer c.Close()
	c.Write(benchHdr('D', n))
	t0 := time.Now()
	got, _ := io.Copy(io.Discard, c)
	if got != n {
		return 0
	}
	return mbps(got, time.Since(t0))
}

// 2000 idle tunnels: 40 loopback source addresses x 50 connections spread over 10 services (the gateway limits a source to 50
// connections and a route to 200 by design, so one source and one route cannot hold 2000).
func idleConns() {
	rss0, fd0 := gwStat("gateway")
	idleFD0 = fd0
	var conns []net.Conn
	var mu sync.Mutex
	var fail atomic.Int64
	var wg sync.WaitGroup
	var firstErr atomic.Value
	t0 := time.Now()
	for k := 0; k < 40; k++ {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			src := &net.TCPAddr{IP: net.IPv4(127, 0, 0, byte(2+k))}
			svc := fmt.Sprintf("idle%02d", k%10)
			for i := 0; i < 50; i++ {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				c, err := gw.Dial(ctx, capURI("shop", svc, "v4", false), &gw.Options{Token: C.CapOK, RootCAs: C.CA, Retry: gw.NoRetry(),
					DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
						return (&net.Dialer{LocalAddr: src}).DialContext(ctx, network, addr)
					}})
				cancel()
				if err != nil {
					fail.Add(1)
					firstErr.CompareAndSwap(nil, err.Error())
					continue
				}
				mu.Lock()
				conns = append(conns, c)
				mu.Unlock()
				time.Sleep(70 * time.Millisecond)
			}
		}(k)
	}
	wg.Wait()
	time.Sleep(2 * time.Second)
	open := connsOpen()
	rss1, fd1 := gwStat("gateway")
	n := len(conns)
	fe, _ := firstErr.Load().(string)
	per := 0.0
	if n > 0 {
		per = float64(rss1-rss0) / float64(n)
	}
	check("bench", "", "2000 idle tunnels", "v4", "cap_", "2000 open (40 sources x 50 over 10 services); gateway memory",
		fmt.Sprintf("opened %d (%d failed %s) in %s; gw_conns_open=%d; gateway RSS %d -> %d KiB (%.0f KiB per connection); fds %d -> %d (%.1f per connection)", n, fail.Load(), trunc(fe, 60), time.Since(t0).Round(time.Second), open, rss0, rss1, per, fd0, fd1, float64(fd1-fd0)/float64(maxInt(n, 1))),
		n == 2000, "terminating TLS per tunnel: PLAN RESOURCES.md estimated ~75 KB per terminated connection (155 MB at 2000)")
	for _, c := range conns {
		c.Close()
	}
	time.Sleep(3 * time.Second)
	rss2, fd2 := gwStat("gateway")
	check("bench", "", "2000 idle tunnels released", "v4", "-", "all connections closed; descriptors return to the baseline", fmt.Sprintf("gw_conns_open=%d, RSS %d KiB (Go keeps freed heap), fds %d (baseline %d) by kind %s", connsOpen(), rss2, fd2, fd0, fdKinds("gateway")), fd2 <= fd0+60, "40 sockets are the keep-alive connections of the gateway HTTP client to the control plane (40 concurrent authorisations); re-checked after the idle period in phase long")
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
var idleFD0 = 16
