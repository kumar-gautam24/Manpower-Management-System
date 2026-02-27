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

// AdminHandler provides CRUD for document types and compliance rules.
type AdminHandler struct {
	db database.Service
}

func NewAdminHandler(db database.Service) *AdminHandler {
	return &AdminHandler{db: db}
}

// ── Document Types ───────────────────────────────────────────

// ListDocumentTypes returns all active document types, ordered by sort_order.
// Accessible to all authenticated users (needed for document forms).
func (h *AdminHandler) ListDocumentTypes(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, doc_type, display_name, is_mandatory, has_expiry,
		       number_label, number_placeholder, expiry_label, sort_order,
		       metadata_fields, is_system, is_active,
		       show_document_number, require_document_number,
		       show_issue_date, require_issue_date,
		       show_expiry_date, require_expiry_date,
		       show_file, require_file,
		       created_at::text, updated_at::text
		FROM document_types
		WHERE is_active = TRUE
		ORDER BY sort_order, display_name
	`)
	if err != nil {
		log.Printf("Failed to list document types: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch document types")
		return
	}
	defer rows.Close()

	var types []models.DocumentType
	for rows.Next() {
		var dt models.DocumentType
		if err := rows.Scan(
			&dt.ID, &dt.DocType, &dt.DisplayName, &dt.IsMandatory, &dt.HasExpiry,
			&dt.NumberLabel, &dt.NumberPlaceholder, &dt.ExpiryLabel, &dt.SortOrder,
			&dt.MetadataFields, &dt.IsSystem, &dt.IsActive,
			&dt.ShowDocumentNumber, &dt.RequireDocumentNumber,
			&dt.ShowIssueDate, &dt.RequireIssueDate,
			&dt.ShowExpiryDate, &dt.RequireExpiryDate,
			&dt.ShowFile, &dt.RequireFile,
			&dt.CreatedAt, &dt.UpdatedAt,
		); err != nil {
			log.Printf("Failed to scan document type: %v", err)
			continue
		}
		types = append(types, dt)
	}

	if types == nil {
		types = []models.DocumentType{}
	}

	JSON(w, http.StatusOK, map[string]interface{}{"data": types})
}

// CreateDocumentType adds a new custom document type (admin-only).
// Custom types are never mandatory — they must be manually added per employee.
func (h *AdminHandler) CreateDocumentType(w http.ResponseWriter, r *http.Request) {
	var req models.CreateDocumentTypeRequest
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

	if req.MetadataFields == nil {
		req.MetadataFields = json.RawMessage("[]")
	}
	if req.NumberLabel == "" {
		req.NumberLabel = "Document Number"
	}
	if req.ExpiryLabel == "" {
		req.ExpiryLabel = "Expiry Date"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	var dt models.DocumentType
	err := pool.QueryRow(ctx, `
		INSERT INTO document_types (doc_type, display_name, is_mandatory, has_expiry,
		    number_label, number_placeholder, expiry_label, sort_order, metadata_fields,
		    is_system, is_active,
		    show_document_number, require_document_number,
		    show_issue_date, require_issue_date,
		    show_expiry_date, require_expiry_date,
		    show_file, require_file)
		VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8, FALSE, TRUE,
		    COALESCE($9, TRUE), COALESCE($10, FALSE),
		    COALESCE($11, TRUE), COALESCE($12, FALSE),
		    COALESCE($13, TRUE), COALESCE($14, FALSE),
		    COALESCE($15, TRUE), COALESCE($16, FALSE))
		RETURNING id, doc_type, display_name, is_mandatory, has_expiry,
		          number_label, number_placeholder, expiry_label, sort_order,
		          metadata_fields, is_system, is_active,
		          show_document_number, require_document_number,
		          show_issue_date, require_issue_date,
		          show_expiry_date, require_expiry_date,
		          show_file, require_file,
		          created_at::text, updated_at::text
	`, req.DocType, req.DisplayName, req.HasExpiry,
		req.NumberLabel, req.NumberPlaceholder, req.ExpiryLabel,
		req.SortOrder, req.MetadataFields,
		req.ShowDocumentNumber, req.RequireDocumentNumber,
		req.ShowIssueDate, req.RequireIssueDate,
		req.ShowExpiryDate, req.RequireExpiryDate,
		req.ShowFile, req.RequireFile,
	).Scan(
		&dt.ID, &dt.DocType, &dt.DisplayName, &dt.IsMandatory, &dt.HasExpiry,
		&dt.NumberLabel, &dt.NumberPlaceholder, &dt.ExpiryLabel, &dt.SortOrder,
		&dt.MetadataFields, &dt.IsSystem, &dt.IsActive,
		&dt.ShowDocumentNumber, &dt.RequireDocumentNumber,
		&dt.ShowIssueDate, &dt.RequireIssueDate,
		&dt.ShowExpiryDate, &dt.RequireExpiryDate,
		&dt.ShowFile, &dt.RequireFile,
		&dt.CreatedAt, &dt.UpdatedAt,
	)
	if err != nil {
		if isDuplicateKeyError(err) {
			JSONError(w, http.StatusConflict, "A document type with this slug already exists")
			return
		}
		log.Printf("Failed to create document type: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create document type")
		return
	}

	go logActivity(pool, userID, "created", "document_type", dt.ID, map[string]interface{}{
		"docType":     dt.DocType,
		"displayName": dt.DisplayName,
	})

	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    dt,
		"message": "Document type created successfully",
	})
}

// UpdateDocumentType edits an existing document type (admin-only).
// Admins can change labels on all types. Metadata fields are read-only for system types.
func (h *AdminHandler) UpdateDocumentType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.UpdateDocumentTypeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	// Check if system type — if so, block metadata_fields changes
	var isSystem bool
	err := pool.QueryRow(ctx, `SELECT is_system FROM document_types WHERE id = $1`, id).Scan(&isSystem)
	if err != nil {
		JSONError(w, http.StatusNotFound, "Document type not found")
		return
	}

	if isSystem && req.MetadataFields != nil {
		JSONError(w, http.StatusForbidden, "Cannot modify metadata fields on system document types")
		return
	}

	var dt models.DocumentType
	err = pool.QueryRow(ctx, `
		UPDATE document_types SET
			display_name       = COALESCE($1, display_name),
			number_label       = COALESCE($2, number_label),
			number_placeholder = COALESCE($3, number_placeholder),
			expiry_label       = COALESCE($4, expiry_label),
			sort_order         = COALESCE($5, sort_order),
			metadata_fields    = COALESCE($6, metadata_fields),
			show_document_number    = COALESCE($8, show_document_number),
			require_document_number = COALESCE($9, require_document_number),
			show_issue_date         = COALESCE($10, show_issue_date),
			require_issue_date      = COALESCE($11, require_issue_date),
			show_expiry_date        = COALESCE($12, show_expiry_date),
			require_expiry_date     = COALESCE($13, require_expiry_date),
			show_file               = COALESCE($14, show_file),
			require_file            = COALESCE($15, require_file),
			updated_at         = NOW()
		WHERE id = $7
		RETURNING id, doc_type, display_name, is_mandatory, has_expiry,
		          number_label, number_placeholder, expiry_label, sort_order,
		          metadata_fields, is_system, is_active,
		          show_document_number, require_document_number,
		          show_issue_date, require_issue_date,
		          show_expiry_date, require_expiry_date,
		          show_file, require_file,
		          created_at::text, updated_at::text
	`, req.DisplayName, req.NumberLabel, req.NumberPlaceholder,
		req.ExpiryLabel, req.SortOrder, req.MetadataFields, id,
		req.ShowDocumentNumber, req.RequireDocumentNumber,
		req.ShowIssueDate, req.RequireIssueDate,
		req.ShowExpiryDate, req.RequireExpiryDate,
		req.ShowFile, req.RequireFile,
	).Scan(
		&dt.ID, &dt.DocType, &dt.DisplayName, &dt.IsMandatory, &dt.HasExpiry,
		&dt.NumberLabel, &dt.NumberPlaceholder, &dt.ExpiryLabel, &dt.SortOrder,
		&dt.MetadataFields, &dt.IsSystem, &dt.IsActive,
		&dt.ShowDocumentNumber, &dt.RequireDocumentNumber,
		&dt.ShowIssueDate, &dt.RequireIssueDate,
		&dt.ShowExpiryDate, &dt.RequireExpiryDate,
		&dt.ShowFile, &dt.RequireFile,
		&dt.CreatedAt, &dt.UpdatedAt,
	)
	if err != nil {
		log.Printf("Failed to update document type: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to update document type")
		return
	}

	go logActivity(pool, userID, "updated", "document_type", dt.ID, map[string]interface{}{
		"docType":     dt.DocType,
		"displayName": dt.DisplayName,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    dt,
		"message": "Document type updated successfully",
	})
}

// DeleteDocumentType soft-deletes a custom document type (admin-only).
// System types cannot be deleted.
func (h *AdminHandler) DeleteDocumentType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	var isSystem bool
	var docType string
	err := pool.QueryRow(ctx, `SELECT is_system, doc_type FROM document_types WHERE id = $1`, id).Scan(&isSystem, &docType)
	if err != nil {
		JSONError(w, http.StatusNotFound, "Document type not found")
		return
	}

	if isSystem {
		JSONError(w, http.StatusForbidden, "Cannot delete system document types")
		return
	}

	_, err = pool.Exec(ctx, `UPDATE document_types SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, id)
	if err != nil {
		log.Printf("Failed to delete document type: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete document type")
		return
	}

	go logActivity(pool, userID, "deleted", "document_type", id, map[string]interface{}{
		"docType": docType,
	})

	JSON(w, http.StatusOK, map[string]interface{}{"message": "Document type deleted successfully"})
}

// ── Compliance Rules ─────────────────────────────────────────

// ListComplianceRules returns rules for a company (merged with global defaults).
// If no company_id is provided, returns global defaults only.
func (h *AdminHandler) ListComplianceRules(w http.ResponseWriter, r *http.Request) {
	companyID := r.URL.Query().Get("company_id")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Fetch all active document types with their effective rules for this company
	query := `
		SELECT dt.doc_type, dt.display_name, dt.is_mandatory AS global_mandatory,
		       COALESCE(cr.grace_period_days, gr.grace_period_days, 0) AS grace_period_days,
		       COALESCE(cr.fine_per_day, gr.fine_per_day, 0) AS fine_per_day,
		       COALESCE(cr.fine_type, gr.fine_type, 'daily') AS fine_type,
		       COALESCE(cr.fine_cap, gr.fine_cap, 0) AS fine_cap,
		       cr.is_mandatory AS company_mandatory,
		       cr.id AS rule_id
		FROM document_types dt
		LEFT JOIN compliance_rules cr ON cr.doc_type = dt.doc_type AND cr.company_id = $1
		LEFT JOIN compliance_rules gr ON gr.doc_type = dt.doc_type AND gr.company_id IS NULL
		WHERE dt.is_active = TRUE
		ORDER BY dt.sort_order, dt.display_name
	`

	var rows interface{ Close() }
	var err error

	type ruleRow struct {
		DocType          string  `json:"docType"`
		DisplayName      string  `json:"displayName"`
		GlobalMandatory  bool    `json:"globalMandatory"`
		GracePeriodDays  int     `json:"gracePeriodDays"`
		FinePerDay       float64 `json:"finePerDay"`
		FineType         string  `json:"fineType"`
		FineCap          float64 `json:"fineCap"`
		CompanyMandatory *bool   `json:"companyMandatory"`
		RuleID           *string `json:"ruleId"`
	}

	var companyIDPtr *string
	if companyID != "" {
		companyIDPtr = &companyID
	}

	pgRows, qErr := pool.Query(ctx, query, companyIDPtr)
	if qErr != nil {
		log.Printf("Failed to list compliance rules: %v", qErr)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch compliance rules")
		return
	}
	rows = pgRows
	err = qErr
	_ = err
	defer rows.Close()

	var rules []ruleRow
	for pgRows.Next() {
		var rr ruleRow
		if err := pgRows.Scan(
			&rr.DocType, &rr.DisplayName, &rr.GlobalMandatory,
			&rr.GracePeriodDays, &rr.FinePerDay, &rr.FineType, &rr.FineCap,
			&rr.CompanyMandatory, &rr.RuleID,
		); err != nil {
			log.Printf("Failed to scan compliance rule: %v", err)
			continue
		}
		rules = append(rules, rr)
	}

	if rules == nil {
		rules = []ruleRow{}
	}

	JSON(w, http.StatusOK, map[string]interface{}{"data": rules})
}

// UpsertComplianceRules bulk-upserts rules for a company or globally (admin-only).
func (h *AdminHandler) UpsertComplianceRules(w http.ResponseWriter, r *http.Request) {
	var req models.UpsertComplianceRulesRequest
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

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)

	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to save rules")
		return
	}
	defer tx.Rollback(ctx)

	for _, rule := range req.Rules {
		_, err := tx.Exec(ctx, `
			INSERT INTO compliance_rules (company_id, doc_type, grace_period_days, fine_per_day, fine_type, fine_cap, is_mandatory)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (company_id, doc_type)
			DO UPDATE SET
				grace_period_days = EXCLUDED.grace_period_days,
				fine_per_day      = EXCLUDED.fine_per_day,
				fine_type         = EXCLUDED.fine_type,
				fine_cap          = EXCLUDED.fine_cap,
				is_mandatory      = EXCLUDED.is_mandatory,
				updated_at        = NOW()
		`, req.CompanyID, rule.DocType, rule.GracePeriodDays,
			rule.FinePerDay, rule.FineType, rule.FineCap, rule.IsMandatory)
		if err != nil {
			log.Printf("Failed to upsert rule for %s: %v", rule.DocType, err)
			JSONError(w, http.StatusInternalServerError, "Failed to save rule for "+rule.DocType)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("Failed to commit rules: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to save rules")
		return
	}

	scope := "global"
	if req.CompanyID != nil {
		scope = *req.CompanyID
	}
	go logActivity(pool, userID, "updated", "compliance_rules", scope, map[string]interface{}{
		"ruleCount": len(req.Rules),
		"companyId": req.CompanyID,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Compliance rules saved successfully",
	})
}

// ── Document Dependencies ────────────────────────────────────

type dependencyRow struct {
	ID              string `json:"id"`
	BlockingDocType string `json:"blockingDocType"`
	BlockedDocType  string `json:"blockedDocType"`
	Description     string `json:"description"`
	CreatedAt       string `json:"createdAt"`
}

// ListDependencies returns all dependency rules.
func (h *AdminHandler) ListDependencies(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, blocking_doc_type, blocked_doc_type, description, created_at::text
		FROM document_dependencies
		ORDER BY blocking_doc_type, blocked_doc_type
	`)
	if err != nil {
		log.Printf("Error listing dependencies: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch dependencies")
		return
	}
	defer rows.Close()

	deps := []dependencyRow{}
	for rows.Next() {
		var d dependencyRow
		if err := rows.Scan(&d.ID, &d.BlockingDocType, &d.BlockedDocType, &d.Description, &d.CreatedAt); err != nil {
			continue
		}
		deps = append(deps, d)
	}

	JSON(w, http.StatusOK, map[string]interface{}{"data": deps})
}

// CreateDependency adds a new dependency rule.
func (h *AdminHandler) CreateDependency(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BlockingDocType string `json:"blockingDocType"`
		BlockedDocType  string `json:"blockedDocType"`
		Description     string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if req.BlockingDocType == "" || req.BlockedDocType == "" || req.Description == "" {
		JSONError(w, http.StatusUnprocessableEntity, "All fields are required")
		return
	}
	if req.BlockingDocType == req.BlockedDocType {
		JSONError(w, http.StatusUnprocessableEntity, "A document type cannot block itself")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var dep dependencyRow
	err := pool.QueryRow(ctx, `
		INSERT INTO document_dependencies (blocking_doc_type, blocked_doc_type, description)
		VALUES ($1, $2, $3)
		RETURNING id, blocking_doc_type, blocked_doc_type, description, created_at::text
	`, req.BlockingDocType, req.BlockedDocType, req.Description).Scan(
		&dep.ID, &dep.BlockingDocType, &dep.BlockedDocType, &dep.Description, &dep.CreatedAt,
	)
	if err != nil {
		log.Printf("Error creating dependency: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create dependency")
		return
	}

	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	go logActivity(pool, userID, "created", "dependency", dep.ID, map[string]interface{}{
		"blocking": req.BlockingDocType, "blocked": req.BlockedDocType,
	})

	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    dep,
		"message": "Dependency rule created",
	})
}

// UpdateDependency modifies an existing dependency rule.
func (h *AdminHandler) UpdateDependency(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		BlockingDocType string `json:"blockingDocType"`
		BlockedDocType  string `json:"blockedDocType"`
		Description     string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if req.BlockingDocType == "" || req.BlockedDocType == "" || req.Description == "" {
		JSONError(w, http.StatusUnprocessableEntity, "All fields are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var dep dependencyRow
	err := pool.QueryRow(ctx, `
		UPDATE document_dependencies
		SET blocking_doc_type = $1, blocked_doc_type = $2, description = $3
		WHERE id = $4
		RETURNING id, blocking_doc_type, blocked_doc_type, description, created_at::text
	`, req.BlockingDocType, req.BlockedDocType, req.Description, id).Scan(
		&dep.ID, &dep.BlockingDocType, &dep.BlockedDocType, &dep.Description, &dep.CreatedAt,
	)
	if err != nil {
		JSONError(w, http.StatusNotFound, "Dependency rule not found")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    dep,
		"message": "Dependency rule updated",
	})
}

// DeleteDependency removes a dependency rule.
func (h *AdminHandler) DeleteDependency(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	tag, err := pool.Exec(ctx, "DELETE FROM document_dependencies WHERE id = $1", id)
	if err != nil {
		log.Printf("Error deleting dependency: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete dependency")
		return
	}
	if tag.RowsAffected() == 0 {
		JSONError(w, http.StatusNotFound, "Dependency rule not found")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Dependency rule deleted",
	})
}
