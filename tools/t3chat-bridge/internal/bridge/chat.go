package bridge

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

const chatURL = "https://t3.chat/api/chat"

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("read request body: %v", err), http.StatusBadRequest)
		return
	}

	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, chatURL, bytes.NewReader(body))
	if err != nil {
		http.Error(w, fmt.Sprintf("create upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	s.applyT3Headers(request)

	response, err := s.config.Client.Do(request)
	if err != nil {
		http.Error(w, fmt.Sprintf("chat upstream request failed: %v", err), http.StatusBadGateway)
		fmt.Println(err)
		return
	}
	defer response.Body.Close()

	copyHeader(w.Header(), response.Header, "Content-Type", "Cache-Control")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(response.StatusCode)

	flusher, _ := w.(http.Flusher)
	buffer := make([]byte, 32*1024)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr == io.EOF {
			return
		}
		if readErr != nil {
			return
		}
	}
}
