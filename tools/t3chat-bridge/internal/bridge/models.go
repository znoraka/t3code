package bridge

import (
	"fmt"
	"io"
	"net/http"
)

const modelsURL = "https://t3.chat/api/trpc/getAllModelBenchmarks"

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response, err := s.doSimpleRequest(r, http.MethodGet, modelsURL)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		writeJSON(w, response.StatusCode, map[string]any{
			"error":  "upstream request failed",
			"status": response.StatusCode,
			"body":   string(body),
		})
		return
	}

	copyHeader(w.Header(), response.Header, "Content-Type")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (s *Server) doSimpleRequest(r *http.Request, method string, url string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(r.Context(), method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create upstream request: %w", err)
	}
	s.applyT3Headers(request)

	response, err := s.config.Client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	return response, nil
}
