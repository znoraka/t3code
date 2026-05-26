package tlsclient

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"time"

	"golang.org/x/net/http2"
	utls "github.com/refraction-networking/utls"
)

func New() *http.Client {
	dialTLSContext := func(ctx context.Context, network, addr string, _ *tls.Config) (net.Conn, error) {
		dialer := &net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}
		rawConn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}

		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			rawConn.Close()
			return nil, err
		}

		tlsConn := utls.UClient(rawConn, &utls.Config{
			ServerName: host,
			MinVersion: tls.VersionTLS12,
			NextProtos: []string{"h2", "http/1.1"},
		}, utls.HelloChrome_Auto)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			rawConn.Close()
			return nil, err
		}
		return tlsConn, nil
	}

	transport := &http2.Transport{
		DialTLSContext: dialTLSContext,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   0,
	}
}
