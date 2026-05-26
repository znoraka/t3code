package bridge

import (
	"encoding/json"
	"net/http"
)

const authCheckURL = "https://t3.chat/api/trpc/auth.getActiveSessions?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22includeLocation%22%3Afalse%7D%7D%7D"

func (s *Server) handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response, err := s.doSimpleRequest(r, http.MethodGet, authCheckURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()

	ok := response.StatusCode >= 200 && response.StatusCode < 300
	copyHeader(w.Header(), response.Header, "Content-Type")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     ok,
		"status": response.StatusCode,
	})
}
