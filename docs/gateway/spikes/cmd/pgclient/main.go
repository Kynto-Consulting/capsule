// pgclient: cliente pgx real. Conecta a 127.0.0.1:PUERTO pero con host=NOMBRE (para que el SNI sea NOMBRE).
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func main() {
	host, port, mode := os.Args[1], os.Args[2], os.Args[3] // mode: require|disable
	cfg, err := pgconn.ParseConfig(fmt.Sprintf("postgres://u:p@%s:%s/d?sslmode=%s&connect_timeout=5", host, port, mode))
	if err != nil {
		panic(err)
	}
	dst := "127.0.0.1"
	if len(os.Args) > 4 {
		dst = os.Args[4]
	}
	cfg.LookupFunc = func(ctx context.Context, h string) ([]string, error) { return []string{dst}, nil }
	cfg.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(dst, port))
	}
	_, err = pgconn.ConnectConfig(context.Background(), cfg)
	fmt.Printf("pgx host=%s sslmode=%s -> %v\n", host, mode, err)
}
