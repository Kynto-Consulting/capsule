// Package common: utilidades de los experimentos del gateway (certificados de prueba, peek de ClientHello, pipe).
package common

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"io"
	"math/big"
	"net"
	"time"
)

// SelfSigned genera un certificado autofirmado (solo para pruebas) con los nombres dados.
func SelfSigned(cn string, names ...string) tls.Certificate {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	t := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: cn},
		DNSNames: names, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, _ := x509.CreateCertificate(rand.Reader, t, t, &k.PublicKey, k)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: k}
}

// RecConn graba lo leído y, mientras Rec, descarta lo escrito (para que crypto/tls no mande alertas al cliente).
type RecConn struct {
	net.Conn
	Buf bytes.Buffer
	Rec bool
}

func (c *RecConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if c.Rec && n > 0 {
		c.Buf.Write(p[:n])
	}
	return n, err
}
func (c *RecConn) Write(p []byte) (int, error) {
	if c.Rec {
		return len(p), nil
	}
	return c.Conn.Write(p)
}

var errAbort = errors.New("peek-done")

// PeekHello lee el ClientHello sin responder. Devuelve SNI, ALPN y los bytes leídos (para reenviar).
func PeekHello(c net.Conn) (sni string, alpn []string, raw []byte, err error) {
	rc := &RecConn{Conn: c, Rec: true}
	got := false
	cfg := &tls.Config{GetConfigForClient: func(h *tls.ClientHelloInfo) (*tls.Config, error) {
		sni, alpn, got = h.ServerName, h.SupportedProtos, true
		return nil, errAbort
	}}
	_ = tls.Server(rc, cfg).Handshake()
	if !got {
		return "", nil, nil, errors.New("no ClientHello")
	}
	return sni, alpn, rc.Buf.Bytes(), nil
}

// Replay devuelve una conexión que primero entrega raw y luego sigue leyendo de c.
type Replay struct {
	net.Conn
	R io.Reader
}

func NewReplay(c net.Conn, raw []byte) *Replay {
	return &Replay{Conn: c, R: io.MultiReader(bytes.NewReader(raw), c)}
}
func (r *Replay) Read(p []byte) (int, error) { return r.R.Read(p) }

type closeWriter interface{ CloseWrite() error }

// Pipe copia en ambos sentidos con half-close y devuelve bytes (a->b, b->a).
func Pipe(a, b net.Conn) (ab, ba int64) {
	done := make(chan int64, 2)
	cp := func(dst, src net.Conn) {
		n, _ := io.Copy(dst, src)
		if cw, ok := dst.(closeWriter); ok {
			cw.CloseWrite()
		} else if tc, ok := dst.(*tls.Conn); ok {
			tc.CloseWrite()
		}
		done <- n
	}
	go cp(b, a)
	go cp(a, b)
	ab = <-done
	ba = <-done
	a.Close()
	b.Close()
	return
}
