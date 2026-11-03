// ct: cliente `capsule tunnel` de prueba. Modo stdio (ProxyCommand) o -listen (reenvio local TCP/UDP).
package main

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"

	"gwspikes/common"
)

func dial(gw, token, target, proto string) (*tls.Conn, *bufio.Reader, error) {
	// En produccion se fija la CA de Capsule en vez de InsecureSkipVerify.
	c, err := tls.Dial("tcp", gw, &tls.Config{ServerName: "tunnel.gw.test", NextProtos: []string{"capsule-tunnel/1"}, InsecureSkipVerify: true})
	if err != nil {
		return nil, nil, err
	}
	b, _ := json.Marshal(map[string]string{"token": token, "target": target, "proto": proto})
	c.Write(append(b, '\n'))
	br := bufio.NewReader(c)
	l, err := br.ReadString('\n')
	if err != nil || l != "OK\n" {
		c.Close()
		return nil, nil, fmt.Errorf("denegado: %q %v", l, err)
	}
	return c, br, nil
}

type rw struct {
	io.Reader
	io.Writer
	net.Conn
}

func (r *rw) Read(p []byte) (int, error)  { return r.Reader.Read(p) }
func (r *rw) Write(p []byte) (int, error) { return r.Writer.Write(p) }
func (r *rw) CloseWrite() error { return r.Conn.(*tls.Conn).CloseWrite() }

func main() {
	gw := flag.String("gw", "127.0.0.1:8443", "gateway")
	token := flag.String("token", "", "token")
	target := flag.String("target", "", "destino interno")
	proto := flag.String("proto", "tcp", "tcp|udp")
	listen := flag.String("listen", "", "reenvio local")
	flag.Parse()
	if *listen == "" { // stdio
		c, br, err := dial(*gw, *token, *target, "tcp")
		if err != nil {
			log.Fatal(err)
		}
		go io.Copy(c, os.Stdin)
		io.Copy(os.Stdout, br)
		return
	}
	if *proto == "udp" {
		ua, _ := net.ResolveUDPAddr("udp", *listen)
		u, err := net.ListenUDP("udp", ua)
		if err != nil {
			log.Fatal(err)
		}
		c, br, err := dial(*gw, *token, *target, "udp")
		if err != nil {
			log.Fatal(err)
		}
		var mu sync.Mutex
		var last *net.UDPAddr
		go func() {
			var h [2]byte
			for {
				if _, err := io.ReadFull(br, h[:]); err != nil {
					return
				}
				b := make([]byte, int(h[0])<<8|int(h[1]))
				io.ReadFull(br, b)
				mu.Lock()
				a := last
				mu.Unlock()
				if a != nil {
					u.WriteToUDP(b, a)
				}
			}
		}()
		b := make([]byte, 65536)
		for {
			n, from, _ := u.ReadFromUDP(b)
			mu.Lock()
			last = from
			mu.Unlock()
			c.Write(append([]byte{byte(n >> 8), byte(n)}, b[:n]...))
		}
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Fprintln(os.Stderr, "ct escuchando en", ln.Addr())
	for {
		l, _ := ln.Accept()
		go func() {
			c, br, err := dial(*gw, *token, *target, "tcp")
			if err != nil {
				l.Close()
				return
			}
			common.Pipe(l, &rw{Reader: br, Writer: c, Conn: c})
		}()
	}
}
