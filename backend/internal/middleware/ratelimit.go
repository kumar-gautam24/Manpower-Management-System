package middleware

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipLimiter stores per-IP rate limiters with automatic cleanup.
type ipLimiter struct {
	limiters map[string]*limiterEntry
	mu       sync.Mutex
	rate     rate.Limit
	burst    int
}

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newIPLimiter(r rate.Limit, burst int) *ipLimiter {
	ipl := &ipLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     r,
		burst:    burst,
	}
	// Clean up stale entries every 5 minutes
	go ipl.cleanup()
	return ipl
}

func (ipl *ipLimiter) getLimiter(ip string) *rate.Limiter {
	ipl.mu.Lock()
	defer ipl.mu.Unlock()

	entry, exists := ipl.limiters[ip]
	if !exists {
		limiter := rate.NewLimiter(ipl.rate, ipl.burst)
		ipl.limiters[ip] = &limiterEntry{limiter: limiter, lastSeen: time.Now()}
		return limiter
	}

	entry.lastSeen = time.Now()
	return entry.limiter
}

// cleanup removes entries not seen in the last 10 minutes to prevent memory leaks.
func (ipl *ipLimiter) cleanup() {
	for {
		time.Sleep(5 * time.Minute)
		ipl.mu.Lock()
		for ip, entry := range ipl.limiters {
			if time.Since(entry.lastSeen) > 10*time.Minute {
				delete(ipl.limiters, ip)
			}
		}
		ipl.mu.Unlock()
	}
}

// RateLimit returns middleware that limits requests per IP.
// r is the number of requests allowed per second, burst is the max burst size.
//
// Example: RateLimit(0.1, 5) allows 1 request every 10 seconds, with burst of 5.
// For login: RateLimit(rate.Every(12*time.Second), 5) = ~5 attempts/minute max.
func RateLimit(r rate.Limit, burst int) func(http.Handler) http.Handler {
	ipl := newIPLimiter(r, burst)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractIP(r)
			limiter := ipl.getLimiter(ip)

			if !limiter.Allow() {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Too many requests. Please try again later.",
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// extractIP gets the client IP, respecting X-Forwarded-For from reverse proxies (Render).
func extractIP(r *http.Request) string {
	// Render (and most proxies) set X-Forwarded-For
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP (the original client)
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}
	return r.RemoteAddr
}
