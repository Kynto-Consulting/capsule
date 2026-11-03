// gw: prototipo de gateway propio (plano de datos). Demux por: preambulo PostgreSQL SSLRequest, SNI, ALPN capsule-tunnel/1.
// Rutas (SNI -> backend, modo passthrough|terminate) se recargan cada 1 s desde un JSON (modela el refresco desde el plano de control).
package main

import (
	"bufio"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"gwspikes/common"
)

type Route struct {
	SNI     string `json:"sni"`
	Mode    string `json:"mode"` // passthrough | terminate
	Backend string `json:"backend"`
}
type Table struct {
	Routes []Route             `json:"routes"`
	Tokens map[string][]string `json:"tokens"` // token -> destinos permitidos
}

var table atomic.Pointer[Table]
var quiet bool
var nconn, active atomic.Int64

func load(path string) {
	var last time.Time
	for {
		if st, err := os.Stat(path); err == nil && st.ModTime() != last {
			b, _ := os.ReadFile(path)
			var t Table
			if json.Unmarshal(b, &t) == nil {
				table.Store(&t)
				last = st.ModTime()
				log.Printf(`{"ev":"routes_reloaded","n":%d}`, len(t.Routes))
			}
		}
		time.Sleep(time.Second)
	}
}

func lookup(sni string) *Route {
	t := table.Load()
	if t == nil {
		return nil
	}
	for i := range t.Routes {
		r := &t.Routes[i]
		if r.SNI == sni || (strings.HasPrefix(r.SNI, "*.") && strings.HasSuffix(sni, r.SNI[1:])) {
			return r
		}
	}
	return nil
}

type bconn struct {
	net.Conn
	r io.Reader
}

func (b *bconn) Read(p []byte) (int, error) { return b.r.Read(p) }

func handle(c net.Conn, cert tls.Certificate, gwCert tls.Certificate) {
	defer active.Add(-1)
	start := time.Now()
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	br := bufio.NewReader(c)
	first, err := br.Peek(8)
	if err != nil {
		c.Close()
		return
	}
	in := &bconn{Conn: c, r: br}
	pgClassic := binary.BigEndian.Uint32(first[:4]) == 8 && binary.BigEndian.Uint32(first[4:]) == 80877103
	if pgClassic {
		br.Discard(8)
		c.Write([]byte{'S'})
	}
	sni, alpn, raw, err := common.PeekHello(in)
	c.SetReadDeadline(time.Time{})
	if err != nil {
		c.Close()
		return
	}
	tun := false
	for _, a := range alpn {
		if a == "capsule-tunnel/1" {
			tun = true
		}
	}
	var ab, ba int64
	result := "ok"
	route := sni
	switch {
	case tun:
		route = "tunnel"
		result, ab, ba = tunnel(common.NewReplay(c, raw), gwCert)
	default:
		r := lookup(sni)
		if r == nil {
			result = "no_route" // misma respuesta (cierre) para inexistente y no autorizado: sin enumeracion
			c.Close()
			break
		}
		bk, err := net.DialTimeout("tcp", r.Backend, 5*time.Second)
		if err != nil {
			result = "backend_down"
			c.Close()
			break
		}
		rp := common.NewReplay(c, raw)
		if r.Mode == "terminate" {
			t := tls.Server(rp, &tls.Config{Certificates: []tls.Certificate{cert}})
			if err := t.Handshake(); err != nil {
				result = "tls_fail"
				c.Close()
				bk.Close()
				break
			}
			ab, ba = common.Pipe(t, bk)
		} else {
			if pgClassic { // repetir SSLRequest hacia el backend y consumir su 'S'
				bk.Write([]byte{0, 0, 0, 8, 4, 210, 22, 47})
				var s [1]byte
				io.ReadFull(bk, s[:])
			}
			bk.Write(raw)
			ab, ba = common.Pipe(c, bk)
		}
	}
	if !quiet {
		log.Printf(`{"ev":"conn","route":%q,"pg_preamble":%v,"result":%q,"bytes_in":%d,"bytes_out":%d,"ms":%d}`,
			route, pgClassic, result, ab, ba, time.Since(start).Milliseconds())
	}
}

type pre struct {
	Token  string `json:"token"`
	Target string `json:"target"`
	Proto  string `json:"proto"`
}

func tunnel(rp net.Conn, gwCert tls.Certificate) (string, int64, int64) {
	t := tls.Server(rp, &tls.Config{Certificates: []tls.Certificate{gwCert}, NextProtos: []string{"capsule-tunnel/1"}})
	if t.Handshake() != nil {
		return "tls_fail", 0, 0
	}
	t.SetReadDeadline(time.Now().Add(5 * time.Second))
	// el cliente espera "OK" antes de enviar datos, asi que leer byte a byte hasta \n no pierde datos
	var line []byte
	one := make([]byte, 1)
	for len(line) < 512 {
		if _, err := t.Read(one); err != nil {
			t.Close()
			return "bad_preamble", 0, 0
		}
		if one[0] == '\n' {
			break
		}
		line = append(line, one[0])
	}
	var p pre
	if json.Unmarshal(line, &p) != nil {
		t.Close()
		return "bad_preamble", 0, 0
	}
	t.SetReadDeadline(time.Time{})
	ok := false
	if tb := table.Load(); tb != nil {
		for _, d := range tb.Tokens[p.Token] {
			if d == p.Target {
				ok = true
			}
		}
	}
	if !ok {
		t.Write([]byte("ERR\n"))
		t.Close()
		return "denied", 0, 0
	}
	if p.Proto == "udp" {
		ua, _ := net.ResolveUDPAddr("udp", p.Target)
		u, err := net.DialUDP("udp", nil, ua)
		if err != nil {
			t.Write([]byte("ERR\n"))
			return "udp_dial", 0, 0
		}
		t.Write([]byte("OK\n"))
		var up, down int64
		go func() { // backend -> cliente, trama: len16 + datos
			b := make([]byte, 65536)
			for {
				n, err := u.Read(b)
				if err != nil {
					return
				}
				h := []byte{byte(n >> 8), byte(n)}
				t.Write(append(h, b[:n]...))
				down += int64(n)
			}
		}()
		var h [2]byte
		for {
			if _, err := io.ReadFull(t, h[:]); err != nil {
				break
			}
			n := int(h[0])<<8 | int(h[1])
			b := make([]byte, n)
			if _, err := io.ReadFull(t, b); err != nil {
				break
			}
			u.Write(b)
			up += int64(n)
		}
		u.Close()
		return "ok_udp", up, down
	}
	bk, err := net.DialTimeout("tcp", p.Target, 5*time.Second)
	if err != nil {
		t.Write([]byte("ERR\n"))
		return "backend_down", 0, 0
	}
	t.Write([]byte("OK\n"))
	ab, ba := common.Pipe(t, bk)
	return "ok", ab, ba
}

func main() {
	listen := flag.String("listen", "[::]:8443", "direccion (doble pila con [::])")
	routes := flag.String("routes", "routes.json", "tabla de rutas")
	flag.BoolVar(&quiet, "quiet", false, "sin log por conexion")
	flag.Parse()
	go load(*routes)
	cert := common.SelfSigned("gateway", "*.db.test", "*.git.test", "*.apps.test")
	gwCert := common.SelfSigned("tunnel.gw.test", "tunnel.gw.test")
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Fprintln(os.Stderr, "gw escuchando en", ln.Addr())
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		active.Add(1)
		nconn.Add(1)
		go handle(c, cert, gwCert)
	}
}
