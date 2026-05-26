package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/t3tools/t3chat-bridge/internal/bridge"
	"github.com/t3tools/t3chat-bridge/internal/tlsclient"
)

const version = "0.1.0"

func main() {
	var (
		port            = flag.Int("port", envInt("PORT", 0), "port to listen on")
		listenHost      = flag.String("listen-host", envString("LISTEN_HOST", "127.0.0.1"), "host to listen on")
		wosSession      = flag.String("wos-session", envString("T3CHAT_WOS_SESSION", ""), "t3.chat wos-session cookie value")
		convexSessionID = flag.String("convex-session-id", envString("T3CHAT_CONVEX_SESSION_ID", ""), "t3.chat convex session id")
		showVersion     = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("t3chat-bridge %s\n", version)
		return
	}

	client := tlsclient.New()
	server := bridge.NewServer(bridge.Config{
		Version:         version,
		ListenHost:      *listenHost,
		Port:            *port,
		WOSSession:      *wosSession,
		ConvexSessionID: *convexSessionID,
		Client:          client,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := server.Run(ctx); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func envString(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return fallback
	}
	return parsed
}
