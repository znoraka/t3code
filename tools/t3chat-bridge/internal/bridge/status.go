package bridge

import (
	"net/http"
)

func (s *Server) applyT3Headers(request *http.Request) {
	request.Header.Set("Origin", "https://t3.chat")
	request.Header.Set("Referer", "https://t3.chat/")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	request.Header.Set("sec-ch-ua", `"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"`)
	request.Header.Set("sec-ch-ua-mobile", "?0")
	request.Header.Set("sec-ch-ua-platform", `"macOS"`)
	request.Header.Set("sec-fetch-dest", "empty")
	request.Header.Set("sec-fetch-mode", "cors")
	request.Header.Set("sec-fetch-site", "same-origin")
	if s.config.WOSSession != "" {
		request.Header.Add("Cookie", "wos-session="+s.config.WOSSession)
	}
	if s.config.ConvexSessionID != "" {
		request.Header.Add("Cookie", "convex-session-id="+s.config.ConvexSessionID)
	}
}

func copyHeader(dst http.Header, src http.Header, keys ...string) {
	for _, key := range keys {
		if value := src.Get(key); value != "" {
			dst.Set(key, value)
		}
	}
}
