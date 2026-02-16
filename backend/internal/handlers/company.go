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

// CompanyHandler handles company-related HTTP requests.
type CompanyHandler struct {
	db database.Service
}

// NewCompanyHandler creates a new CompanyHandler with the provided database service.
func NewCompanyHandler(db database.Service) *CompanyHandler {
	return &CompanyHandler{db: db}
}

// ── List ───────────────────────────────────────────────────────

// List returns all companies, ordered alphabetically.
func (h *CompanyHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name, COALESCE(c.currency, 'AED'),
			c.trade_license_number, c.establishment_card_number,
			c.mohre_category, c.regulatory_authority,
			c.created_at::text, c.updated_at::text,
			COUNT(e.id) AS employee_count
		FROM companies c
		LEFT JOIN employees e ON e.company_id = c.id
		GROUP BY c.id, c.name, c.currency,
			c.trade_license_number, c.establishment_card_number,
			c.mohre_category, c.regulatory_authority,
			c.created_at, c.updated_at
		ORDER BY c.name ASC
	`)
	if err != nil {
		log.Printf("Error fetching companies: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch companies")
		return
	}
	defer rows.Close()

	type CompanyWithCount struct {
		models.Company
		EmployeeCount int `json:"employeeCount"`
	}

	companies := []CompanyWithCount{}
	for rows.Next() {
		var c CompanyWithCount
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Currency,
			&c.TradeLicenseNumber, &c.EstablishmentCardNumber,
			&c.MohreCategory, &c.RegulatoryAuthority,
			&c.CreatedAt, &c.UpdatedAt,
			&c.EmployeeCount,
		); err != nil {
			log.Printf("Error scanning company: %v", err)
			continue
		}
		companies = append(companies, c)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": companies,
	})
}

// ── Create ─────────────────────────────────────────────────────

// createCompanyRequest defines the accepted fields for company creation/update.
type createCompanyRequest struct {
	Name                    string  `json:"name"`
	Currency                string  `json:"currency"`
	TradeLicenseNumber      *string `json:"tradeLicenseNumber,omitempty"`
	EstablishmentCardNumber *string `json:"establishmentCardNumber,omitempty"`
	MohreCategory           *string `json:"mohreCategory,omitempty"`
	RegulatoryAuthority     *string `json:"regulatoryAuthority,omitempty"`
}

// Create adds a new company.
func (h *CompanyHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.Name == "" {
		JSONError(w, http.StatusUnprocessableEntity, "Company name is required")
		return
	}
	if req.Currency == "" {
		req.Currency = "AED"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Link company to the logged-in user (if available)
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	var company models.Company
	err := pool.QueryRow(ctx, `
		INSERT INTO companies (
			name, currency, user_id,
			trade_license_number, establishment_card_number,
			mohre_category, regulatory_authority
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, name, currency,
			trade_license_number, establishment_card_number,
			mohre_category, regulatory_authority,
			created_at::text, updated_at::text
	`, req.Name, req.Currency, nilIfEmptyStr(userID),
		req.TradeLicenseNumber, req.EstablishmentCardNumber,
		req.MohreCategory, req.RegulatoryAuthority,
	).Scan(
		&company.ID, &company.Name, &company.Currency,
		&company.TradeLicenseNumber, &company.EstablishmentCardNumber,
		&company.MohreCategory, &company.RegulatoryAuthority,
		&company.CreatedAt, &company.UpdatedAt,
	)

	if err != nil {
		if isDuplicateKeyError(err) {
			JSONError(w, http.StatusConflict, "A company with this name already exists")
			return
		}
		log.Printf("Error creating company: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create company")
		return
	}

	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    company,
		"message": "Company created successfully",
	})
}

// ── Update ─────────────────────────────────────────────────────

// Update modifies a company's details.
func (h *CompanyHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req createCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.Name == "" {
		JSONError(w, http.StatusUnprocessableEntity, "Company name is required")
		return
	}
	if req.Currency == "" {
		req.Currency = "AED"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var company models.Company
	err := pool.QueryRow(ctx, `
		UPDATE companies SET
			name = $1, currency = $2, updated_at = NOW(),
			trade_license_number = $3, establishment_card_number = $4,
			mohre_category = $5, regulatory_authority = $6
		WHERE id = $7
		RETURNING id, name, currency,
			trade_license_number, establishment_card_number,
			mohre_category, regulatory_authority,
			created_at::text, updated_at::text
	`, req.Name, req.Currency,
		req.TradeLicenseNumber, req.EstablishmentCardNumber,
		req.MohreCategory, req.RegulatoryAuthority,
		id,
	).Scan(
		&company.ID, &company.Name, &company.Currency,
		&company.TradeLicenseNumber, &company.EstablishmentCardNumber,
		&company.MohreCategory, &company.RegulatoryAuthority,
		&company.CreatedAt, &company.UpdatedAt,
	)

	if err != nil {
		if isDuplicateKeyError(err) {
			JSONError(w, http.StatusConflict, "A company with this name already exists")
			return
		}
		JSONError(w, http.StatusNotFound, "Company not found")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    company,
		"message": "Company updated successfully",
	})
}

// ── Delete ─────────────────────────────────────────────────────

// Delete removes a company and cascades to its employees and documents.
func (h *CompanyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	result, err := pool.Exec(ctx, "DELETE FROM companies WHERE id = $1", id)
	if err != nil {
		log.Printf("Error deleting company: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete company")
		return
	}

	if result.RowsAffected() == 0 {
		JSONError(w, http.StatusNotFound, "Company not found")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Company deleted successfully",
	})
}

// ── Helpers ────────────────────────────────────────────────────

// nilIfEmptyStr returns nil for empty strings (for nullable DB columns)
func nilIfEmptyStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
