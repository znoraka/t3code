package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

type config struct {
	bridgePath    string
	bridgeURL     string
	wosSession    string
	convexID      string
	model         string
	effort        string
	yolo          bool
	cwd           string
	initialPrompt string
}

func main() {
	cfg := parseFlags()

	m := newModel(cfg)
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
	}
	m.cleanup()

	if m.fatalErr != nil {
		fmt.Fprintf(os.Stderr, "Fatal: %v\n", m.fatalErr)
		os.Exit(1)
	}
}

func parseFlags() config {
	var cfg config
	flag.StringVar(&cfg.bridgePath, "bridge-path", envOr("T3CHAT_BRIDGE_PATH", "t3chat-bridge"), "path to t3chat-bridge binary")
	flag.StringVar(&cfg.bridgeURL, "bridge-url", os.Getenv("T3CHAT_BRIDGE_URL"), "URL of running bridge (skip spawn)")
	flag.StringVar(&cfg.wosSession, "wos-session", os.Getenv("T3CHAT_WOS_SESSION"), "t3.chat wos-session cookie")
	flag.StringVar(&cfg.convexID, "convex-id", os.Getenv("T3CHAT_CONVEX_SESSION_ID"), "t3.chat convex session ID")
	flag.StringVar(&cfg.model, "model", envOr("T3CLI_MODEL", "claude-4-sonnet"), "model to use")
	flag.StringVar(&cfg.effort, "effort", envOr("T3CLI_EFFORT", "high"), "reasoning effort: none/low/medium/high")
	flag.BoolVar(&cfg.yolo, "yolo", false, "auto-approve all tool executions")
	help := flag.Bool("help", false, "show help")
	flag.Parse()

	if *help {
		fmt.Println(`t3cli — lite coding agent powered by t3.chat

Usage: t3cli [flags] [prompt]

Flags:`)
		flag.PrintDefaults()
		fmt.Println(`
In-session:
  /model           Open model picker
  /model <name>    Switch model directly
  /clear           Clear conversation history
  esc              Cancel current generation
  ctrl+c           Quit`)
		os.Exit(0)
	}

	if cfg.bridgeURL == "" {
		if cfg.wosSession == "" {
			fmt.Fprintln(os.Stderr, "Error: --wos-session or T3CHAT_WOS_SESSION required")
			os.Exit(1)
		}
		if cfg.convexID == "" {
			fmt.Fprintln(os.Stderr, "Error: --convex-id or T3CHAT_CONVEX_SESSION_ID required")
			os.Exit(1)
		}
	}

	cfg.cwd, _ = os.Getwd()
	if args := flag.Args(); len(args) > 0 {
		cfg.initialPrompt = strings.Join(args, " ")
	}
	return cfg
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
