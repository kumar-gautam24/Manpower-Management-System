package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"manpower-backend/internal/ctxkeys"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// AuthHandler manages user registration, login, and profile retrieval.
type AuthHandler struct {
	db        database.Service
	jwtSecret []byte
}

// NewAuthHandler creates an AuthHandler with the given database and JWT signing key.
func NewAuthHandler(db database.Service, jwtSecret string) *AuthHandler {
	return &AuthHandler{
		db:        db,
		jwtSecret: []byte(jwtSecret),
	}
}

// Register creates a new user account.
// Hashes the password with bcrypt and returns a JWT token on success.
// New users default to the "viewer" role for security; pass role="admin" to grant full access.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errs := req.Validate(); len(errs) > 0 {
		JSON(w, http.StatusUnprocessableEntity, map[string]interface{}{
			"error":   "Validation failed",
			"details": errs,
		})
		return
	}

	// All new users are registered as "viewer" for security.
	// Admin role is granted by existing admins via User Management.
	role := "viewer"

	// Hash the password (cost 12 balances security and speed)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		log.Printf("Failed to hash password: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create account")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Insert user — UNIQUE constraint on email prevents duplicates
	var user models.User
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, name, role, created_at::text, updated_at::text
	`, req.Email, string(hashedPassword), req.Name, role,
	).Scan(
		&user.ID, &user.Email, &user.Name,
		&user.Role, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		// Check for duplicate email
		if isDuplicateKeyError(err) {
			JSONError(w, http.StatusConflict, "An account with this email already exists")
			return
		}
		log.Printf("Failed to create user: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create account")
		return
	}

	// Generate JWT token for immediate login after registration
	token, err := h.generateToken(user.ID, user.Role)
	if err != nil {
		log.Printf("Failed to generate token: %v", err)
		JSONError(w, http.StatusInternalServerError, "Account created but login failed")
		return
	}

	JSON(w, http.StatusCreated, models.AuthResponse{
		Token: token,
		User:  user,
	})
}

// Login authenticates a user with email + password and returns a JWT token.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errs := req.Validate(); len(errs) > 0 {
		JSON(w, http.StatusUnprocessableEntity, map[string]interface{}{
			"error":   "Validation failed",
			"details": errs,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Fetch user by email (including password hash for verification)
	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, email, password_hash, name, role, created_at::text, updated_at::text
		FROM users WHERE email = $1
	`, req.Email,
	).Scan(
		&user.ID, &user.Email, &user.PasswordHash,
		&user.Name, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		// Generic message to prevent email enumeration attacks
		JSONError(w, http.StatusUnauthorized, "Invalid email or password")
		return
	}

	// Compare password against stored hash
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		JSONError(w, http.StatusUnauthorized, "Invalid email or password")
		return
	}

	token, err := h.generateToken(user.ID, user.Role)
	if err != nil {
		log.Printf("Failed to generate token: %v", err)
		JSONError(w, http.StatusInternalServerError, "Login failed")
		return
	}

	JSON(w, http.StatusOK, models.AuthResponse{
		Token: token,
		User:  user,
	})
}

// GetMe returns the profile of the currently authenticated user.
// For scoped users (company_owner, viewer), includes their assigned company IDs.
func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, email, name, role, created_at::text, updated_at::text
		FROM users WHERE id = $1
	`, userID,
	).Scan(
		&user.ID, &user.Email, &user.Name,
		&user.Role, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		JSONError(w, http.StatusNotFound, "User not found")
		return
	}

	type MeResponse struct {
		models.User
		CompanyIDs []string `json:"companyIds,omitempty"`
	}

	resp := MeResponse{User: user}

	if user.Role == "company_owner" || user.Role == "viewer" {
		rows, err := pool.Query(ctx,
			`SELECT company_id::text FROM user_companies WHERE user_id = $1`, userID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					resp.CompanyIDs = append(resp.CompanyIDs, id)
				}
			}
		}
		if resp.CompanyIDs == nil {
			resp.CompanyIDs = []string{}
		}
	}

	JSON(w, http.StatusOK, resp)
}

// generateToken creates a signed JWT with user ID and role as claims.
// Tokens expire after 7 days.
func (h *AuthHandler) generateToken(userID, role string) (string, error) {
	claims := jwt.MapClaims{
		"userId": userID,
		"role":   role,
		"exp":    time.Now().Add(7 * 24 * time.Hour).Unix(),
		"iat":    time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(h.jwtSecret)
}

// isDuplicateKeyError checks if a PostgreSQL error is a unique constraint violation.
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "23505")
}
