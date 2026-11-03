package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

// Destination servers the gateway services point at. They run inside the harness (loopback), so the gateway reaches them exactly as
// it would reach a project container on the docker host.

type srvSet struct {
	mu sync.Mutex
	ls map[int]net.Listener
}

var targets = &srvSet{ls: map[int]net.Listener{}}

func (s *srvSet) listen(port int, h func(net.Conn)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ls[port]; ok {
		return nil
	}
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	s.ls[port] = l
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go h(c)
		}
	}()
	return nil
}

func (s *srvSet) stop(port int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l, ok := s.ls[port]; ok {
		l.Close()
		delete(s.ls, port)
	}
}

func (s *srvSet) stopAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for p, l := range s.ls {
		l.Close()
		delete(s.ls, p)
	}
}

// echo: copies until the client half-closes, then half-closes back (what a real service that answers EOF does).
func echoConn(c net.Conn) {
	defer c.Close()
	io.Copy(c, c)
	if cw, ok := c.(interface{ CloseWrite() error }); ok {
		cw.CloseWrite()
	}
}

// bench: "D"+u64 n = send n bytes then close; "U"+u64 n = read n bytes, answer 8 bytes (count); anything else behaves as echo.
func benchConn(c net.Conn) {
	defer c.Close()
	var hdr [9]byte
	if _, err := io.ReadFull(c, hdr[:]); err != nil {
		return
	}
	n := int64(binary.BigEndian.Uint64(hdr[1:]))
	switch hdr[0] {
	case 'D':
		buf := make([]byte, 1<<20)
		for i := range buf {
			buf[i] = byte(i * 7)
		}
		for n > 0 {
			k := int64(len(buf))
			if n < k {
				k = n
			}
			if _, err := c.Write(buf[:k]); err != nil {
				return
			}
			n -= k
		}
		if cw, ok := c.(interface{ CloseWrite() error }); ok {
			cw.CloseWrite()
		}
	case 'U':
		got, _ := io.CopyN(io.Discard, c, n)
		var ack [8]byte
		binary.BigEndian.PutUint64(ack[:], uint64(got))
		c.Write(ack[:])
	}
}

var activeIdle atomic.Int64

func startTargets() error {
	for _, p := range []int{55407, 55408, 55410, 55411} {
		if err := targets.listen(p, echoConn); err != nil {
			return err
		}
	}
	for i := 0; i < 10; i++ {
		if err := targets.listen(55500+i, func(c net.Conn) { activeIdle.Add(1); echoConn(c); activeIdle.Add(-1) }); err != nil {
			return err
		}
	}
	if err := targets.listen(55409, benchConn); err != nil {
		return err
	}
	for _, s := range []struct {
		port int
		name string
	}{{55422, "one"}, {55423, "two"}, {55424, "deny"}} {
		srv, err := newSSHServer(s.name)
		if err != nil {
			return err
		}
		if err := targets.listen(s.port, srv.handle); err != nil {
			return err
		}
	}
	return nil
}

// ---- a real SSH server (golang.org/x/crypto/ssh): the stock OpenSSH client talks to it through the gateway ----

type sshSrv struct {
	cfg  *ssh.ServerConfig
	name string
}

var sshAuthorized ssh.PublicKey

func newSSHServer(name string) (*sshSrv, error) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, err
	}
	cfg := &ssh.ServerConfig{PublicKeyCallback: func(m ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
		if sshAuthorized != nil && string(k.Marshal()) == string(sshAuthorized.Marshal()) {
			return nil, nil
		}
		return nil, fmt.Errorf("unknown key")
	}}
	cfg.AddHostKey(signer)
	return &sshSrv{cfg: cfg, name: name}, nil
}

func (s *sshSrv) handle(nc net.Conn) {
	defer nc.Close()
	nc.SetDeadline(time.Now().Add(2 * time.Minute))
	conn, chans, reqs, err := ssh.NewServerConn(nc, s.cfg)
	if err != nil {
		return
	}
	defer conn.Close()
	go ssh.DiscardRequests(reqs)
	for nch := range chans {
		if nch.ChannelType() != "session" {
			nch.Reject(ssh.UnknownChannelType, "no")
			continue
		}
		ch, creqs, err := nch.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer ch.Close()
			for r := range creqs {
				if r.Type != "exec" {
					r.Reply(false, nil)
					continue
				}
				var p struct{ Cmd string }
				ssh.Unmarshal(r.Payload, &p)
				r.Reply(true, nil)
				status := 0
				switch {
				case strings.HasPrefix(p.Cmd, "echo "):
					fmt.Fprintln(ch, strings.TrimPrefix(p.Cmd, "echo "))
				case strings.HasPrefix(p.Cmd, "ticks "):
					secs, _ := strconv.Atoi(strings.TrimPrefix(p.Cmd, "ticks "))
					nc.SetDeadline(time.Now().Add(time.Duration(secs+60) * time.Second))
					for i := 1; i*15 <= secs; i++ {
						time.Sleep(15 * time.Second)
						if _, err := fmt.Fprintf(ch, "tick %d\n", i); err != nil {
							return
						}
					}
					fmt.Fprintln(ch, "done")
				case p.Cmd == "whoami":
					fmt.Fprintln(ch, "interop-ssh-"+s.name)
				case p.Cmd == "big":
					buf := make([]byte, 1<<20)
					for i := 0; i < 5; i++ {
						ch.Write(buf)
					}
				default:
					fmt.Fprintln(ch.Stderr(), "unsupported")
					status = 127
				}
				ch.SendRequest("exit-status", false, ssh.Marshal(struct{ S uint32 }{uint32(status)}))
				return
			}
		}()
	}
}

// makeSSHKey writes an ed25519 private key (OpenSSH format via ssh-keygen) and authorises its public half.
func makeSSHKey(dir string) (keyPath string, err error) {
	keyPath = dir + "/id_interop"
	os.Remove(keyPath)
	os.Remove(keyPath + ".pub")
	if out, code := run(cmdOpts{}, "ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", keyPath); code != 0 {
		return "", fmt.Errorf("ssh-keygen: %s", out)
	}
	pub, err := os.ReadFile(keyPath + ".pub")
	if err != nil {
		return "", err
	}
	k, _, _, _, err := ssh.ParseAuthorizedKey(pub)
	if err != nil {
		return "", err
	}
	sshAuthorized = k
	return keyPath, nil
}
