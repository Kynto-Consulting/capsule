package main

import (
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

// pgQuery speaks just enough of the PostgreSQL wire protocol to run one real query over conn (a gateway tunnel):
// SSLRequest -> TLS inside the tunnel (verified against the test CA) -> StartupMessage (role "tr", trust over TLS) -> simple Query.
func pgQuery(conn net.Conn, sql string) (string, error) {
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	if _, err := conn.Write([]byte{0, 0, 0, 8, 4, 210, 22, 47}); err != nil {
		return "", err
	}
	var one [1]byte
	if _, err := io.ReadFull(conn, one[:]); err != nil {
		return "", fmt.Errorf("sslrequest answer: %w", err)
	}
	if one[0] != 'S' {
		return "", fmt.Errorf("server refused TLS (%q)", one[0])
	}
	tc := tls.Client(conn, &tls.Config{ServerName: "pg.target.test", RootCAs: C.CA, MinVersion: tls.VersionTLS12})
	if err := tc.Handshake(); err != nil {
		return "", fmt.Errorf("inner TLS: %w", err)
	}
	body := []byte("\x00\x03\x00\x00user\x00tr\x00database\x00app\x00\x00")
	msg := make([]byte, 4, 4+len(body))
	binary.BigEndian.PutUint32(msg, uint32(4+len(body)))
	if _, err := tc.Write(append(msg, body...)); err != nil {
		return "", err
	}
	if err := pgUntilReady(tc, nil); err != nil {
		return "", err
	}
	q := append([]byte(sql), 0)
	hdr := make([]byte, 5)
	hdr[0] = 'Q'
	binary.BigEndian.PutUint32(hdr[1:], uint32(4+len(q)))
	if _, err := tc.Write(append(hdr, q...)); err != nil {
		return "", err
	}
	var rows []string
	if err := pgUntilReady(tc, &rows); err != nil {
		return "", err
	}
	tc.Write([]byte{'X', 0, 0, 0, 4})
	return strings.Join(rows, ","), nil
}

func pgUntilReady(r io.Reader, rows *[]string) error {
	for {
		var h [5]byte
		if _, err := io.ReadFull(r, h[:]); err != nil {
			return fmt.Errorf("pg read: %w", err)
		}
		n := int(binary.BigEndian.Uint32(h[1:])) - 4
		if n < 0 || n > 1<<20 {
			return fmt.Errorf("pg: bad message length")
		}
		b := make([]byte, n)
		if _, err := io.ReadFull(r, b); err != nil {
			return fmt.Errorf("pg read: %w", err)
		}
		switch h[0] {
		case 'E':
			return fmt.Errorf("pg error: %s", strings.ReplaceAll(string(b), "\x00", " "))
		case 'R':
			if len(b) >= 4 && binary.BigEndian.Uint32(b) != 0 {
				return fmt.Errorf("pg wants authentication (%d)", binary.BigEndian.Uint32(b))
			}
		case 'D':
			if rows != nil && len(b) >= 6 {
				l := int(int32(binary.BigEndian.Uint32(b[2:6])))
				if l >= 0 && 6+l <= len(b) {
					*rows = append(*rows, string(b[6:6+l]))
				}
			}
		case 'Z':
			return nil
		}
	}
}

const rowSQL = "select v from blob where id=1"
