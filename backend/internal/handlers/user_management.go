package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"manpower-backend/internal/ctxkeys"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// UserManagementHandler provides admin-only user listing, role changes, and deletion.
type UserManagementHandler struct {
	db database.Service
}

func NewUserManagementHandler(db database.Service) *UserManagementHandler {
	return &UserManagementHandler{db: db}
}

// List returns users visible to the current admin.
// admin sees everyone except super_admin/admin; super_admin sees all.
func (h *UserManagementHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	currentRole, _ := r.Context().Value(ctxkeys.UserRole).(string)

	query := `
		SELECT id, email, name, role, created_at::text, updated_at::text
		FROM users
	`
	if currentRole != "super_admin" {
		query += ` WHERE role NOT IN ('super_admin', 'admin')`
	}
	query += ` ORDER BY created_at DESC`

	rows, err := pool.Query(ctx, query)
	if err != nil {
		log.Printf("Failed to list users: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch users")
		return
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.CreatedAt, &u.UpdatedAt); err != nil {
			log.Printf("Failed to scan user row: %v", err)
			continue
		}
		users = append(users, u)
	}

	if users == nil {
		users = []models.User{}
	}

	JSON(w, http.StatusOK, map[string]interface{}{"data": users})
}

// UpdateRole changes a user's role with hierarchical restrictions.
func (h *UserManagementHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	currentUserID, _ := r.Context().Value(ctxkeys.UserID).(string)
	currentRole, _ := r.Context().Value(ctxkeys.UserRole).(string)

	if targetID == currentUserID {
		JSONError(w, http.StatusBadRequest, "Cannot change your own role")
		return
	}

	var req models.UpdateRoleRequest
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

	// Admin can only assign company_owner or viewer
	if currentRole != "super_admin" {
		if req.Role == "admin" || req.Role == "super_admin" {
			JSONError(w, http.StatusForbidden, "Only super_admin can assign admin or super_admin roles")
			return
		}
		// Admin cannot change roles of admin/super_admin users
		var targetRole string
		h.db.GetPool().QueryRow(r.Context(), "SELECT role FROM users WHERE id = $1", targetID).Scan(&targetRole)
		if targetRole == "admin" || targetRole == "super_admin" {
			JSONError(w, http.StatusForbidden, "Cannot modify admin or super_admin users")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var user models.User
	err := pool.QueryRow(ctx, `
		UPDATE users SET role = $1, updated_at = NOW()
		WHERE id = $2
		RETURNING id, email, name, role, created_at::text, updated_at::text
	`, req.Role, targetID).Scan(
		&user.ID, &user.Email, &user.Name, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		JSONError(w, http.StatusNotFound, "User not found")
		return
	}

	go logActivity(pool, currentUserID, "updated_role", "user", targetID, map[string]interface{}{
		"newRole": req.Role,
		"email":   user.Email,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    user,
		"message": "Role updated successfully",
	})
}

// Delete removes a user with hierarchical restrictions.
func (h *UserManagementHandler) Delete(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	currentUserID, _ := r.Context().Value(ctxkeys.UserID).(string)
	currentRole, _ := r.Context().Value(ctxkeys.UserRole).(string)

	if targetID == currentUserID {
		JSONError(w, http.StatusBadRequest, "Cannot delete your own account")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var email, targetRole string
	err := pool.QueryRow(ctx, `SELECT email, role FROM users WHERE id = $1`, targetID).Scan(&email, &targetRole)
	if err != nil {
		JSONError(w, http.StatusNotFound, "User not found")
		return
	}

	// Admin cannot delete admin/super_admin
	if currentRole != "super_admin" && (targetRole == "admin" || targetRole == "super_admin") {
		JSONError(w, http.StatusForbidden, "Cannot delete admin or super_admin users")
		return
	}

	tag, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, targetID)
	if err != nil {
		log.Printf("Failed to delete user: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete user")
		return
	}

	if tag.RowsAffected() == 0 {
		JSONError(w, http.StatusNotFound, "User not found")
		return
	}

	go logActivity(pool, currentUserID, "deleted", "user", targetID, map[string]interface{}{
		"email": email,
	})

	JSON(w, http.StatusOK, map[string]interface{}{"message": "User deleted successfully"})
}

// ── Company Assignment ─────────────────────────────────────────

// GetUserCompanies returns the company IDs assigned to a user.
func (h *UserManagementHandler) GetUserCompanies(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT uc.company_id::text, c.name
		FROM user_companies uc
		JOIN companies c ON c.id = uc.company_id
		WHERE uc.user_id = $1
		ORDER BY c.name ASC
	`, userID)
	if err != nil {
		log.Printf("Failed to get user companies: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch company assignments")
		return
	}
	defer rows.Close()

	type Assignment struct {
		CompanyID   string `json:"companyId"`
		CompanyName string `json:"companyName"`
	}
	assignments := []Assignment{}
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.CompanyID, &a.CompanyName); err != nil {
			continue
		}
		assignments = append(assignments, a)
	}

	JSON(w, http.StatusOK, map[string]interface{}{"data": assignments})
}

// SetUserCompanies replaces all company assignments for a user.
func (h *UserManagementHandler) SetUserCompanies(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")

	var req struct {
		CompanyIDs []string `json:"companyIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	tx, err := pool.Begin(ctx)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "Failed to update assignments")
		return
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM user_companies WHERE user_id = $1`, userID)
	if err != nil {
		log.Printf("Failed to clear user companies: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to update assignments")
		return
	}

	for _, companyID := range req.CompanyIDs {
		_, err = tx.Exec(ctx,
			`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			userID, companyID,
		)
		if err != nil {
			log.Printf("Failed to assign company %s to user %s: %v", companyID, userID, err)
			continue
		}
	}

	if err := tx.Commit(ctx); err != nil {
		JSONError(w, http.StatusInternalServerError, "Failed to update assignments")
		return
	}

	currentUserID, _ := r.Context().Value(ctxkeys.UserID).(string)
	go logActivity(pool, currentUserID, "assigned_companies", "user", userID, map[string]interface{}{
		"companyIds": req.CompanyIDs,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Company assignments updated",
	})
}
