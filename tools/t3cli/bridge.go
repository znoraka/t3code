package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"
)

type bridge struct {
	url     string
	process *exec.Cmd
}

func spawnBridge(cfg config) (*bridge, error) {
	if cfg.bridgeURL != "" {
		return &bridge{url: cfg.bridgeURL}, nil
	}

	cmd := exec.Command(cfg.bridgePath,
		"--listen-host", "127.0.0.1",
		"--port", "0",
		"--wos-session", cfg.wosSession,
		"--convex-session-id", cfg.convexID,
	)
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start bridge: %w", err)
	}

	urlCh := make(chan string, 1)
	errCh := make(chan error, 1)
	re := regexp.MustCompile(`t3chat-bridge listening on (http://\S+)`)

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if m := re.FindStringSubmatch(scanner.Text()); m != nil {
				urlCh <- m[1]
				return
			}
		}
		errCh <- fmt.Errorf("bridge exited without ready signal")
	}()

	select {
	case url := <-urlCh:
		return &bridge{url: url, process: cmd}, nil
	case err := <-errCh:
		cmd.Process.Kill()
		return nil, err
	case <-time.After(5 * time.Second):
		cmd.Process.Kill()
		return nil, fmt.Errorf("bridge startup timed out")
	}
}

func (b *bridge) kill() {
	if b.process == nil || b.process.Process == nil {
		return
	}
	_ = b.process.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_ = b.process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = b.process.Process.Kill()
	}
}

// --- Chat streaming ---

type chatMessage struct {
	ID      string
	Role    string
	Content string
}

type chatDelta struct {
	Text string
	Kind string // "text" or "reasoning"
}

type chatRequestMsg struct {
	ID          string        `json:"id"`
	Parts       []msgPart     `json:"parts"`
	Role        string        `json:"role"`
	Attachments []interface{} `json:"attachments"`
}
type msgPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
type chatRequestBody struct {
	Messages          []chatRequestMsg `json:"messages"`
	Model             string           `json:"model"`
	ConvexSessionID   string           `json:"convexSessionId"`
	ModelParams       modelParams      `json:"modelParams"`
	ResponseMessageID string           `json:"responseMessageId"`
	ThreadMetadata    threadMeta       `json:"threadMetadata"`
	ClientAuth        clientAuth       `json:"clientAuth"`
	Preferences       map[string]any   `json:"preferences"`
	UserInfo          userInfo         `json:"userInfo"`
	IsEphemeral       bool             `json:"isEphemeral"`
}
type modelParams struct {
	ReasoningEffort string `json:"reasoningEffort"`
	IncludeSearch   bool   `json:"includeSearch"`
}
type threadMeta struct {
	ID string `json:"id"`
}
type clientAuth struct {
	IsSignedIn bool `json:"isSignedIn"`
}
type userInfo struct {
	Timezone string `json:"timezone"`
	Locale   string `json:"locale"`
}

var reasoningTypes = map[string]bool{
	"reasoning": true, "thinking": true, "thought": true,
	"reasoning-delta": true, "reasoning_delta": true,
}

func streamChat(ctx context.Context, bridgeURL string, messages []chatMessage, cfg config, out chan<- chatDelta) error {
	reqMsgs := make([]chatRequestMsg, len(messages))
	for i, m := range messages {
		reqMsgs[i] = chatRequestMsg{
			ID:          m.ID,
			Parts:       []msgPart{{Type: "text", Text: m.Content}},
			Role:        m.Role,
			Attachments: []interface{}{},
		}
	}

	body := chatRequestBody{
		Messages:          reqMsgs,
		Model:             cfg.model,
		ConvexSessionID:   cfg.convexID,
		ModelParams:       modelParams{ReasoningEffort: cfg.effort},
		ResponseMessageID: newUUID(),
		ThreadMetadata:    threadMeta{ID: newUUID()},
		ClientAuth:        clientAuth{IsSignedIn: true},
		Preferences:       map[string]any{},
		UserInfo:          userInfo{Timezone: timezone(), Locale: "en-US"},
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, bridgeURL+"/chat", strings.NewReader(string(jsonBody)))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bridge %d: %s", resp.StatusCode, string(b))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := line[6:]
		if data == "[DONE]" {
			return nil
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(data), &parsed); err != nil {
			continue
		}
		if d := extractDelta(parsed); d != nil {
			select {
			case out <- *d:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return scanner.Err()
}

func extractDelta(v map[string]any) *chatDelta {
	kind := "text"
	if t, ok := v["type"].(string); ok && reasoningTypes[t] {
		kind = "reasoning"
	}
	if obj, ok := v["object"].(string); ok && strings.Contains(obj, "reasoning") {
		kind = "reasoning"
	}

	var text string
	switch d := v["delta"].(type) {
	case string:
		text = d
	case map[string]any:
		if t, ok := d["text"].(string); ok {
			text = t
		}
	}
	if text == "" {
		if t, ok := v["text"].(string); ok {
			text = t
		}
	}
	if text == "" {
		if content, ok := v["content"].([]any); ok {
			var sb strings.Builder
			for _, item := range content {
				if m, ok := item.(map[string]any); ok {
					if t, ok := m["text"].(string); ok {
						sb.WriteString(t)
					}
				}
			}
			text = sb.String()
		}
	}
	if text == "" {
		return nil
	}
	return &chatDelta{Text: text, Kind: kind}
}

func timezone() string {
	if tz := os.Getenv("TZ"); tz != "" {
		return tz
	}
	name, _ := time.Now().Zone()
	if name != "" {
		return name
	}
	return "UTC"
}

// --- Models ---

type modelInfo struct {
	ID       string
	Provider string
}

var providerOrder = map[string]int{
	"Claude": 0, "GPT": 1, "Gemini": 2, "DeepSeek": 3,
	"Grok": 4, "Kimi": 5, "Qwen": 6, "Llama": 7,
}

var fallbackModels = []modelInfo{
	{ID: "claude-4-sonnet", Provider: "Claude"},
	{ID: "claude-4-opus", Provider: "Claude"},
	{ID: "gpt-4.1", Provider: "GPT"},
	{ID: "o4-mini", Provider: "GPT"},
	{ID: "gemini-2.5-pro", Provider: "Gemini"},
	{ID: "deepseek-r1", Provider: "DeepSeek"},
	{ID: "grok-3", Provider: "Grok"},
}

func fetchModels(bridgeURL string) ([]modelInfo, error) {
	resp, err := http.Get(bridgeURL + "/models")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("models %d: %s", resp.StatusCode, string(body))
	}

	var payload struct {
		Result struct {
			Data struct {
				JSON map[string]any `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("parse models: %w", err)
	}

	if len(payload.Result.Data.JSON) == 0 {
		return nil, fmt.Errorf("empty model list")
	}

	models := make([]modelInfo, 0, len(payload.Result.Data.JSON))
	for id := range payload.Result.Data.JSON {
		models = append(models, modelInfo{
			ID:       id,
			Provider: detectProvider(id),
		})
	}

	maxOrd := len(providerOrder)
	sort.Slice(models, func(i, j int) bool {
		oi, ok := providerOrder[models[i].Provider]
		if !ok {
			oi = maxOrd
		}
		oj, ok := providerOrder[models[j].Provider]
		if !ok {
			oj = maxOrd
		}
		if oi != oj {
			return oi < oj
		}
		return models[i].ID < models[j].ID
	})

	return models, nil
}

func detectProvider(id string) string {
	lower := strings.ToLower(id)
	switch {
	case strings.HasPrefix(lower, "claude"):
		return "Claude"
	case strings.HasPrefix(lower, "gpt"), strings.HasPrefix(lower, "o3"), strings.HasPrefix(lower, "o4"):
		return "GPT"
	case strings.HasPrefix(lower, "gemini"), strings.HasPrefix(lower, "gemma"):
		return "Gemini"
	case strings.HasPrefix(lower, "deepseek"):
		return "DeepSeek"
	case strings.HasPrefix(lower, "grok"):
		return "Grok"
	case strings.HasPrefix(lower, "kimi"):
		return "Kimi"
	case strings.HasPrefix(lower, "qwen"):
		return "Qwen"
	case strings.HasPrefix(lower, "llama"):
		return "Llama"
	default:
		return "Other"
	}
}
