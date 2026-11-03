// bench: latencia (ping-pong de 1 byte), throughput (envio de N MB a un sink) y retencion de conexiones ociosas.
package main

import (
	"bufio"
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"net"
	"sort"
	"sync/atomic"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8443", "")
	sni := flag.String("sni", "", "si se da, TLS con este SNI")
	mode := flag.String("mode", "lat", "lat|thr|hold")
	n := flag.Int("n", 2000, "iteraciones / conexiones")
	mb := flag.Int("mb", 256, "MB para thr")
	hold := flag.Duration("hold", 20*time.Second, "")
	flag.Parse()
	dial := func() (net.Conn, error) {
		if *sni != "" {
			return tls.Dial("tcp", *addr, &tls.Config{ServerName: *sni, InsecureSkipVerify: true})
		}
		return net.Dial("tcp", *addr)
	}
	switch *mode {
	case "lat":
		c, err := dial()
		if err != nil {
			panic(err)
		}
		r := bufio.NewReader(c)
		var d []time.Duration
		b := []byte{1}
		for i := 0; i < *n+200; i++ {
			t := time.Now()
			c.Write(b)
			r.ReadByte()
			if i >= 200 {
				d = append(d, time.Since(t))
			}
		}
		sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
		fmt.Printf("lat n=%d p50=%v p95=%v p99=%v\n", len(d), d[len(d)/2], d[len(d)*95/100], d[len(d)*99/100])
	case "thr":
		c, err := dial()
		if err != nil {
			panic(err)
		}
		buf := make([]byte, 64<<10)
		t := time.Now()
		for i := 0; i < *mb*16; i++ {
			c.Write(buf)
		}
		if tc, ok := c.(*tls.Conn); ok {
			tc.CloseWrite()
		} else {
			c.(*net.TCPConn).CloseWrite()
		}
		io.ReadAll(c)
		s := time.Since(t).Seconds()
		fmt.Printf("thr %d MB en %.2fs = %.0f MB/s (%.2f Gbit/s)\n", *mb, s, float64(*mb)/s, float64(*mb)*8/s/1000)
	case "hold":
		var ok, fail atomic.Int64
		sem := make(chan struct{}, 64)
		done := make(chan struct{})
		for i := 0; i < *n; i++ {
			sem <- struct{}{}
			go func() {
				c, err := dial()
				<-sem
				if err != nil {
					fail.Add(1)
					return
				}
				ok.Add(1)
				<-done
				c.Close()
			}()
		}
		for len(sem) > 0 {
			time.Sleep(50 * time.Millisecond)
		}
		time.Sleep(500 * time.Millisecond)
		fmt.Printf("hold establecidas=%d fallidas=%d, reteniendo %v\n", ok.Load(), fail.Load(), *hold)
		time.Sleep(*hold)
		close(done)
	}
}
