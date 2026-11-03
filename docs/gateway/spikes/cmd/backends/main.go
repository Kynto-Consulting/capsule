// backends: servidores de prueba. Uso: backends tipo:nombre:addr[:modo] ...
//  tls:NOMBRE:ADDR      TLS que responde "NOMBRE" al conectar (cert con CN=NOMBRE)
//  tlsecho:NOMBRE:ADDR  eco TLS
//  echo:_:ADDR          eco TCP plano      sink:_:ADDR  descarta y responde total al EOF
//  udpecho:_:ADDR       eco UDP
//  pg:NOMBRE:ADDR:ssl|direct|plain   PostgreSQL falso (SSLRequest+TLS / TLS directo con ALPN postgresql / sin TLS)
//  ssh:NOMBRE:ADDR      servidor SSH (x/crypto/ssh) que contesta al exec con su nombre
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"

	"golang.org/x/crypto/ssh"
	"gwspikes/common"
)

func pgErr(msg string) []byte {
	body := []byte("SFATAL\x00C28000\x00M" + msg + "\x00\x00")
	out := []byte{'E', 0, 0, 0, 0}
	binary.BigEndian.PutUint32(out[1:], uint32(len(body)+4))
	return append(out, body...)
}

func readStartup(c net.Conn) {
	var l [4]byte
	io.ReadFull(c, l[:])
	buf := make([]byte, binary.BigEndian.Uint32(l[:])-4)
	io.ReadFull(c, buf)
}

func main() {
	for _, a := range os.Args[1:] {
		p := strings.SplitN(a, ":", 4)
		kind, name := p[0], p[1]
		rest := strings.Join(p[2:], ":")
		mode := ""
		if kind == "pg" {
			i := strings.LastIndex(rest, ":")
			rest, mode = rest[:i], rest[i+1:]
		}
		addr := rest
		switch kind {
		case "udpecho":
			go func() {
				ua, _ := net.ResolveUDPAddr("udp", addr)
				c, err := net.ListenUDP("udp", ua)
				if err != nil {
					log.Fatal(err)
				}
				b := make([]byte, 65536)
				for {
					n, from, _ := c.ReadFromUDP(b)
					c.WriteToUDP(b[:n], from)
				}
			}()
			continue
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			log.Fatal(err)
		}
		cert := common.SelfSigned(name, name)
		var sshCfg *ssh.ServerConfig
		if kind == "ssh" {
			k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			signer, _ := ssh.NewSignerFromKey(k)
			sshCfg = &ssh.ServerConfig{NoClientAuth: true, ServerVersion: "SSH-2.0-capsule-" + name}
			sshCfg.AddHostKey(signer)
		}
		go func() {
			for {
				c, err := ln.Accept()
				if err != nil {
					return
				}
				go func() {
					defer c.Close()
					switch kind {
					case "tls", "tlsecho":
						t := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{cert}})
						if t.Handshake() != nil {
							return
						}
						if kind == "tls" {
							fmt.Fprintf(t, "hello-from-%s\n", name)
						} else {
							io.Copy(t, t)
						}
					case "echo":
						io.Copy(c, c)
					case "sink":
						n, _ := io.Copy(io.Discard, c)
						fmt.Fprintf(c, "%d\n", n)
					case "pg":
						switch mode {
						case "ssl":
							var h [8]byte
							if _, err := io.ReadFull(c, h[:]); err != nil {
								return
							}
							c.Write([]byte{'S'})
							t := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{cert}})
							if t.Handshake() != nil {
								return
							}
							readStartup(t)
							t.Write(pgErr("backend=" + name + " mode=ssl"))
						case "direct":
							t := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{cert}, NextProtos: []string{"postgresql"}})
							if t.Handshake() != nil {
								return
							}
							readStartup(t)
							t.Write(pgErr("backend=" + name + " mode=direct alpn=" + t.ConnectionState().NegotiatedProtocol))
						case "plain":
							var l [4]byte
							io.ReadFull(c, l[:])
							buf := make([]byte, binary.BigEndian.Uint32(l[:])-4)
							io.ReadFull(c, buf)
							if binary.BigEndian.Uint32(buf) == 80877103 { // SSLRequest
								c.Write([]byte{'N'})
								readStartup(c)
							}
							c.Write(pgErr("backend=" + name + " mode=plain"))
						}
					case "ssh":
						_, chans, reqs, err := ssh.NewServerConn(c, sshCfg)
						if err != nil {
							return
						}
						go ssh.DiscardRequests(reqs)
						for nc := range chans {
							ch, rq, _ := nc.Accept()
							go func() {
								for r := range rq {
									if r.Type == "exec" || r.Type == "shell" {
										r.Reply(true, nil)
										fmt.Fprintf(ch, "ssh-backend=%s\n", name)
										ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
										ch.Close()
										return
									}
									r.Reply(false, nil)
								}
							}()
						}
					}
				}()
			}
		}()
	}
	log.Println("backends listos")
	select {}
}
