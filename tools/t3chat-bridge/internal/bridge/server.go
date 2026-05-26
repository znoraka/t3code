package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

type Config struct {
	Version         string
	ListenHost      string
	Port            int
	WOSSession      string
	ConvexSessionID string
	Client          *http.Client
}

type Server struct {
	config Config
	http   *http.Server
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Received request: %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func NewServer(config Config) *Server {
	mux := http.NewServeMux()
	server := &Server{
		config: config,
		http: &http.Server{
			ReadHeaderTimeout: 10 * time.Second,
			Handler:           loggingMiddleware(mux),
		},
	}

	mux.HandleFunc("/status", server.handleStatus)
	mux.HandleFunc("/models", server.handleModels)
	mux.HandleFunc("/auth/check", server.handleAuthCheck)
	mux.HandleFunc("/chat", server.handleChat)

	return server
}

func (s *Server) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", s.config.ListenHost, s.config.Port))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer listener.Close()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.http.Shutdown(shutdownCtx)
	}()

	fmt.Printf("t3chat-bridge listening on http://%s\n", listener.Addr().String())

	return s.http.Serve(listener)
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"version": s.config.Version,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
