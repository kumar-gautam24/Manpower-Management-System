// Package middleware provides HTTP middleware for authentication and authorization.
package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"manpower-backend/internal/ctxkeys"
)

// Auth validates the JWT token from the Authorization header and
// injects the user's ID and role into the request context.
func Auth(jwtSecret string) func(http.Handler) http.Handler {
	secret := []byte(jwtSecret)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeError(w, http.StatusUnauthorized, "Authorization header required")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				writeError(w, http.StatusUnauthorized, "Invalid authorization format. Use: Bearer <token>")
				return
			}

			token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return secret, nil
			})

			if err != nil || !token.Valid {
				writeError(w, http.StatusUnauthorized, "Invalid or expired token")
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				writeError(w, http.StatusUnauthorized, "Invalid token claims")
				return
			}

			userID, _ := claims["userId"].(string)
			role, _ := claims["role"].(string)

			if userID == "" {
				writeError(w, http.StatusUnauthorized, "Invalid token: missing user ID")
				return
			}

			ctx := context.WithValue(r.Context(), ctxkeys.UserID, userID)
			ctx = context.WithValue(ctx, ctxkeys.UserRole, role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireMinRole returns middleware that restricts access to users with at least
// the specified role level. Role hierarchy: super_admin > admin > company_owner > viewer.
func RequireMinRole(minRole string) func(http.Handler) http.Handler {
	minLevel := ctxkeys.RoleLevel[minRole]

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole, _ := r.Context().Value(ctxkeys.UserRole).(string)
			level := ctxkeys.RoleLevel[userRole]

			if level < minLevel {
				writeError(w, http.StatusForbidden, "Insufficient permissions")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// InjectCompanyScope queries user_companies and injects the accessible company IDs
// into the request context. For admin/super_admin the scope is nil (all companies).
// Must be used after Auth middleware.
func InjectCompanyScope(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole, _ := r.Context().Value(ctxkeys.UserRole).(string)

			if userRole == "admin" || userRole == "super_admin" {
				next.ServeHTTP(w, r)
				return
			}

			userID, _ := r.Context().Value(ctxkeys.UserID).(string)

			rows, err := pool.Query(r.Context(),
				`SELECT company_id::text FROM user_companies WHERE user_id = $1`, userID)
			if err != nil {
				log.Printf("[scope] failed to query user_companies for %s: %v", userID, err)
				writeError(w, http.StatusInternalServerError, "Failed to resolve company access")
				return
			}
			defer rows.Close()

			var ids []string
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					continue
				}
				ids = append(ids, id)
			}
			if ids == nil {
				ids = []string{}
			}

			ctx := context.WithValue(r.Context(), ctxkeys.CompanyScope, ids)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
