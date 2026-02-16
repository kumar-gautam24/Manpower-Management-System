package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"manpower-backend/internal/compliance"
	"manpower-backend/internal/ctxkeys"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// DocumentHandler handles document-related HTTP requests.
type DocumentHandler struct {
	db database.Service
}

// NewDocumentHandler creates a new DocumentHandler.
func NewDocumentHandler(db database.Service) *DocumentHandler {
	return &DocumentHandler{db: db}
}

// ── Column lists & scan helpers ──────────────────────────────────
// Two variants: aliased (for SELECT with FROM) and unaliased (for RETURNING).

const docCols = `d.id, d.employee_id, d.document_type,
	d.document_number, COALESCE(d.issue_date::text, ''), COALESCE(d.expiry_date::text, ''),
	d.grace_period_days, d.fine_per_day, d.fine_type, d.fine_cap,
	d.is_primary, d.is_mandatory, COALESCE(d.metadata::text, '{}'),
	d.file_url, d.file_name, d.file_size, d.file_type,
	d.last_updated, d.created_at`

const docRetCols = `id, employee_id, document_type,
	document_number, COALESCE(issue_date::text, ''), COALESCE(expiry_date::text, ''),
	grace_period_days, fine_per_day, fine_type, fine_cap,
	is_primary, is_mandatory, COALESCE(metadata::text, '{}'),
	file_url, file_name, file_size, file_type,
	last_updated, created_at`

// scanDocument reads all Document columns from a row/rows scanner.
func scanDocument(scanner interface {
	Scan(dest ...interface{}) error
}, doc *models.Document) error {
	var issueDateRaw, expiryRaw, metadataRaw string
	var docNumber *string

	err := scanner.Scan(
		&doc.ID, &doc.EmployeeID, &doc.DocumentType,
		&docNumber, &issueDateRaw, &expiryRaw,
		&doc.GracePeriodDays, &doc.FinePerDay, &doc.FineType, &doc.FineCap,
		&doc.IsPrimary, &doc.IsMandatory, &metadataRaw,
		&doc.FileURL, &doc.FileName, &doc.FileSize, &doc.FileType,
		&doc.LastUpdated, &doc.CreatedAt,
	)
	if err != nil {
		return err
	}

	doc.DocumentNumber = docNumber
	if issueDateRaw != "" {
		doc.IssueDate = &issueDateRaw
	}
	if expiryRaw != "" {
		doc.ExpiryDate = &expiryRaw
	}
	if metadataRaw != "" && metadataRaw != "{}" {
		doc.Metadata = json.RawMessage(metadataRaw)
	} else {
		doc.Metadata = json.RawMessage(`{}`)
	}

	return nil
}

// enrichWithCompliance computes status, fine, and days fields for a document.
func enrichWithCompliance(doc *models.Document) models.DocumentWithCompliance {
	now := time.Now()
	dwc := models.DocumentWithCompliance{
		Document:    *doc,
		DisplayName: compliance.DisplayName(doc.DocumentType),
	}

	// Parse expiry date for computation
	var expiryTime *time.Time
	if doc.ExpiryDate != nil {
		if t, err := time.Parse("2006-01-02", *doc.ExpiryDate); err == nil {
			expiryTime = &t
		}
	}

	// Compute status
	docNum := ""
	if doc.DocumentNumber != nil {
		docNum = *doc.DocumentNumber
	}
	dwc.Status = compliance.ComputeStatus(expiryTime, doc.GracePeriodDays, docNum, now)

	// Compute days remaining
	dwc.DaysRemaining = compliance.DaysRemaining(expiryTime, now)

	// Compute grace days remaining (only when in_grace)
	dwc.GraceDaysRemaining = compliance.GraceDaysRemaining(expiryTime, doc.GracePeriodDays, now)

	// Compute days in penalty (only when penalty_active)
	dwc.DaysInPenalty = compliance.DaysInPenalty(expiryTime, doc.GracePeriodDays, now)

	// Compute fine
	if expiryTime != nil && dwc.Status == compliance.StatusPenaltyActive {
		dwc.EstimatedFine = compliance.ComputeFine(
			*expiryTime, doc.GracePeriodDays,
			doc.FinePerDay, doc.FineType, doc.FineCap, now,
		)
	}

	return dwc
}

// ── Create ───────────────────────────────────────────────────────

// Create handles POST /api/employees/{employeeId}/documents
func (h *DocumentHandler) Create(w http.ResponseWriter, r *http.Request) {
	employeeID := chi.URLParam(r, "employeeId")
	if employeeID == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	var req models.CreateDocumentRequest
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

	// Verify employee exists
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM employees WHERE id = $1)", employeeID).Scan(&exists); err != nil || !exists {
		JSONError(w, http.StatusNotFound, "Employee not found")
		return
	}

	// Default metadata to empty JSON object
	metadata := req.Metadata
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}

	var doc models.Document
	err := pool.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO documents (
			employee_id, document_type, document_number, issue_date, expiry_date,
			grace_period_days, fine_per_day, fine_type, fine_cap,
			is_mandatory, metadata,
			file_url, file_name, file_size, file_type
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING %s
	`, docRetCols),
		employeeID, req.DocumentType,
		req.DocumentNumber, req.IssueDate, req.ExpiryDate,
		nilIntDefault(req.GracePeriodDays, 0),
		nilFloat64Default(req.FinePerDay, 0),
		nilStringDefault(req.FineType, "daily"),
		nilFloat64Default(req.FineCap, 0),
		compliance.IsMandatoryType(req.DocumentType),
		string(metadata),
		req.FileURL, req.FileName, req.FileSize, req.FileType,
	)
	if err2 := scanDocument(err, &doc); err2 != nil {
		log.Printf("Error creating document: %v", err2)
		JSONError(w, http.StatusInternalServerError, "Failed to create document")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "created", "document", doc.ID, map[string]interface{}{
		"type": doc.DocumentType, "employeeId": employeeID,
	})

	result := enrichWithCompliance(&doc)
	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    result,
		"message": "Document created successfully",
	})
}

// ── List by Employee ─────────────────────────────────────────────

// ListByEmployee handles GET /api/employees/{id}/documents
func (h *DocumentHandler) ListByEmployee(w http.ResponseWriter, r *http.Request) {
	employeeID := chi.URLParam(r, "id")
	if employeeID == "" {
		employeeID = chi.URLParam(r, "employeeId")
	}
	if employeeID == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, fmt.Sprintf(`
		SELECT %s
		FROM documents d
		WHERE d.employee_id = $1
		ORDER BY d.is_mandatory DESC, d.document_type ASC, d.created_at DESC
	`, docCols), employeeID)
	if err != nil {
		log.Printf("Error fetching documents: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch documents")
		return
	}
	defer rows.Close()

	documents := []models.DocumentWithCompliance{}
	for rows.Next() {
		var doc models.Document
		if err := scanDocument(rows, &doc); err != nil {
			log.Printf("Error scanning document: %v", err)
			continue
		}
		documents = append(documents, enrichWithCompliance(&doc))
	}

	// Calculate completion stats for mandatory docs
	mandatoryTotal := 0
	mandatoryComplete := 0
	for _, doc := range documents {
		if doc.IsMandatory {
			mandatoryTotal++
			if doc.Status != compliance.StatusIncomplete {
				mandatoryComplete++
			}
		}
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": documents,
		"completion": map[string]int{
			"total":    mandatoryTotal,
			"complete": mandatoryComplete,
		},
	})
}

// ── Get by ID ────────────────────────────────────────────────────

// GetByID handles GET /api/documents/{id}
func (h *DocumentHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Document ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	row := pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT %s, e.name AS employee_name, c.name AS company_name
		FROM documents d
		JOIN employees e ON d.employee_id = e.id
		JOIN companies c ON e.company_id = c.id
		WHERE d.id = $1
	`, docCols), id)

	var doc models.Document
	var employeeName, companyName string

	// We need a custom scan here because of the extra joined columns
	var issueDateRaw, expiryRaw, metadataRaw string
	var docNumber *string
	err := row.Scan(
		&doc.ID, &doc.EmployeeID, &doc.DocumentType,
		&docNumber, &issueDateRaw, &expiryRaw,
		&doc.GracePeriodDays, &doc.FinePerDay, &doc.FineType, &doc.FineCap,
		&doc.IsPrimary, &doc.IsMandatory, &metadataRaw,
		&doc.FileURL, &doc.FileName, &doc.FileSize, &doc.FileType,
		&doc.LastUpdated, &doc.CreatedAt,
		&employeeName, &companyName,
	)
	if err != nil {
		log.Printf("Error fetching document %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Document not found")
		return
	}

	doc.DocumentNumber = docNumber
	if issueDateRaw != "" {
		doc.IssueDate = &issueDateRaw
	}
	if expiryRaw != "" {
		doc.ExpiryDate = &expiryRaw
	}
	doc.Metadata = json.RawMessage(metadataRaw)

	result := enrichWithCompliance(&doc)
	JSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"document":     result,
			"employeeName": employeeName,
			"companyName":  companyName,
		},
	})
}

// ── Update ───────────────────────────────────────────────────────

// Update handles PUT /api/documents/{id}
func (h *DocumentHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Document ID is required")
		return
	}

	var req models.UpdateDocumentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Build dynamic SET clause
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.DocumentType != nil {
		setClauses = append(setClauses, fmt.Sprintf("document_type = $%d", argIdx))
		args = append(args, *req.DocumentType)
		argIdx++
	}
	if req.DocumentNumber != nil {
		setClauses = append(setClauses, fmt.Sprintf("document_number = $%d", argIdx))
		args = append(args, *req.DocumentNumber)
		argIdx++
	}
	if req.IssueDate != nil {
		setClauses = append(setClauses, fmt.Sprintf("issue_date = $%d", argIdx))
		args = append(args, *req.IssueDate)
		argIdx++
	}
	if req.ExpiryDate != nil {
		setClauses = append(setClauses, fmt.Sprintf("expiry_date = $%d", argIdx))
		args = append(args, *req.ExpiryDate)
		argIdx++
	}
	if req.GracePeriodDays != nil {
		setClauses = append(setClauses, fmt.Sprintf("grace_period_days = $%d", argIdx))
		args = append(args, *req.GracePeriodDays)
		argIdx++
	}
	if req.FinePerDay != nil {
		setClauses = append(setClauses, fmt.Sprintf("fine_per_day = $%d", argIdx))
		args = append(args, *req.FinePerDay)
		argIdx++
	}
	if req.FineType != nil {
		setClauses = append(setClauses, fmt.Sprintf("fine_type = $%d", argIdx))
		args = append(args, *req.FineType)
		argIdx++
	}
	if req.FineCap != nil {
		setClauses = append(setClauses, fmt.Sprintf("fine_cap = $%d", argIdx))
		args = append(args, *req.FineCap)
		argIdx++
	}
	if len(req.Metadata) > 0 {
		setClauses = append(setClauses, fmt.Sprintf("metadata = $%d", argIdx))
		args = append(args, string(req.Metadata))
		argIdx++
	}
	if req.FileURL != nil {
		setClauses = append(setClauses, fmt.Sprintf("file_url = $%d", argIdx))
		args = append(args, *req.FileURL)
		argIdx++
	}
	if req.FileName != nil {
		setClauses = append(setClauses, fmt.Sprintf("file_name = $%d", argIdx))
		args = append(args, *req.FileName)
		argIdx++
	}
	if req.FileSize != nil {
		setClauses = append(setClauses, fmt.Sprintf("file_size = $%d", argIdx))
		args = append(args, *req.FileSize)
		argIdx++
	}
	if req.FileType != nil {
		setClauses = append(setClauses, fmt.Sprintf("file_type = $%d", argIdx))
		args = append(args, *req.FileType)
		argIdx++
	}

	if len(setClauses) == 0 {
		JSONError(w, http.StatusBadRequest, "No fields to update")
		return
	}

	setClauses = append(setClauses, "last_updated = NOW()")

	setStr := ""
	for i, clause := range setClauses {
		if i > 0 {
			setStr += ", "
		}
		setStr += clause
	}

	query := fmt.Sprintf(`
		UPDATE documents SET %s
		WHERE id = $%d
		RETURNING %s
	`, setStr, argIdx, docRetCols)
	args = append(args, id)

	var doc models.Document
	if err := scanDocument(pool.QueryRow(ctx, query, args...), &doc); err != nil {
		log.Printf("Error updating document %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Document not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "updated", "document", doc.ID, map[string]interface{}{
		"type": doc.DocumentType,
	})

	result := enrichWithCompliance(&doc)
	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    result,
		"message": "Document updated successfully",
	})
}

// ── Toggle Primary ───────────────────────────────────────────────

// TogglePrimary handles PATCH /api/documents/{id}/primary
func (h *DocumentHandler) TogglePrimary(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Document ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Toggle is_primary on this document (no uniqueness constraint now)
	var currentlyPrimary bool
	err := pool.QueryRow(ctx, `SELECT is_primary FROM documents WHERE id = $1`, id).Scan(&currentlyPrimary)
	if err != nil {
		JSONError(w, http.StatusNotFound, "Document not found")
		return
	}

	newPrimary := !currentlyPrimary
	_, err = pool.Exec(ctx, `UPDATE documents SET is_primary = $1 WHERE id = $2`, newPrimary, id)
	if err != nil {
		log.Printf("Error toggling primary document %s: %v", id, err)
		JSONError(w, http.StatusInternalServerError, "Failed to toggle primary")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	action := "set_primary"
	if currentlyPrimary {
		action = "unset_primary"
	}
	logActivity(pool, userID, action, "document", id, nil)

	JSON(w, http.StatusOK, map[string]string{
		"message": "Primary document updated successfully",
	})
}

// ── Delete ───────────────────────────────────────────────────────

// Delete handles DELETE /api/documents/{id}
func (h *DocumentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Document ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	tag, err := pool.Exec(ctx, "DELETE FROM documents WHERE id = $1", id)
	if err != nil {
		log.Printf("Error deleting document %s: %v", id, err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete document")
		return
	}

	if tag.RowsAffected() == 0 {
		JSONError(w, http.StatusNotFound, "Document not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "deleted", "document", id, nil)

	JSON(w, http.StatusOK, map[string]string{
		"message": "Document deleted successfully",
	})
}

// ── BatchDelete ────────────────────────────────────────────────

// BatchDelete handles POST /api/documents/batch-delete
// Accepts { "ids": ["uuid1", "uuid2", ...] } and deletes all matching documents.
func (h *DocumentHandler) BatchDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if len(req.IDs) == 0 {
		JSONError(w, http.StatusBadRequest, "No document IDs provided")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	tag, err := pool.Exec(ctx, "DELETE FROM documents WHERE id = ANY($1::uuid[])", req.IDs)
	if err != nil {
		log.Printf("Error batch deleting documents: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete documents")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	for _, id := range req.IDs {
		logActivity(pool, userID, "deleted", "document", id, nil)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("%d document(s) deleted successfully", tag.RowsAffected()),
		"deleted": tag.RowsAffected(),
	})
}

// ── Renew ────────────────────────────────────────────────────────

// Renew handles POST /api/documents/{id}/renew
// Creates a new document with updated expiry, copying type/employee from the old one.
func (h *DocumentHandler) Renew(w http.ResponseWriter, r *http.Request) {
	oldID := chi.URLParam(r, "id")
	if oldID == "" {
		JSONError(w, http.StatusBadRequest, "Document ID is required")
		return
	}

	var req struct {
		DocumentNumber *string         `json:"documentNumber,omitempty"`
		IssueDate      *string         `json:"issueDate,omitempty"`
		ExpiryDate     string          `json:"expiryDate"`
		Metadata       json.RawMessage `json:"metadata,omitempty"`
		FileURL        string          `json:"fileUrl,omitempty"`
		FileName       string          `json:"fileName,omitempty"`
		FileSize       int64           `json:"fileSize,omitempty"`
		FileType       string          `json:"fileType,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if req.ExpiryDate == "" {
		JSONError(w, http.StatusUnprocessableEntity, "New expiry date is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Fetch the old document to copy its details
	var oldDoc models.Document
	row := pool.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM documents d WHERE d.id = $1`, docCols), oldID)
	if err := scanDocument(row, &oldDoc); err != nil {
		JSONError(w, http.StatusNotFound, "Original document not found")
		return
	}

	// Use new values if provided, otherwise keep old ones
	docNumber := oldDoc.DocumentNumber
	if req.DocumentNumber != nil {
		docNumber = req.DocumentNumber
	}
	issueDate := oldDoc.IssueDate
	if req.IssueDate != nil {
		issueDate = req.IssueDate
	}
	fileURL := oldDoc.FileURL
	if req.FileURL != "" {
		fileURL = req.FileURL
	}
	fileName := oldDoc.FileName
	if req.FileName != "" {
		fileName = req.FileName
	}
	fileSize := oldDoc.FileSize
	if req.FileSize > 0 {
		fileSize = req.FileSize
	}
	fileType := oldDoc.FileType
	if req.FileType != "" {
		fileType = req.FileType
	}
	metadata := oldDoc.Metadata
	if len(req.Metadata) > 0 {
		metadata = req.Metadata
	}

	// Transaction: insert new doc (no primary toggle needed since constraint removed)
	tx, err := pool.Begin(ctx)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "Failed to start transaction")
		return
	}
	defer tx.Rollback(ctx)

	var newDoc models.Document
	newRow := tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO documents (
			employee_id, document_type, document_number, issue_date, expiry_date,
			grace_period_days, fine_per_day, fine_type, fine_cap,
			is_primary, is_mandatory, metadata,
			file_url, file_name, file_size, file_type
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		RETURNING %s
	`, docRetCols),
		oldDoc.EmployeeID, oldDoc.DocumentType,
		docNumber, issueDate, req.ExpiryDate,
		oldDoc.GracePeriodDays, oldDoc.FinePerDay, oldDoc.FineType, oldDoc.FineCap,
		oldDoc.IsPrimary, oldDoc.IsMandatory, string(metadata),
		fileURL, fileName, fileSize, fileType,
	)

	if err := scanDocument(newRow, &newDoc); err != nil {
		log.Printf("Error inserting renewed document: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create renewed document")
		return
	}

	// Archive the old document by setting is_primary = false
	_, err = tx.Exec(ctx, `UPDATE documents SET is_primary = FALSE WHERE id = $1`, oldID)
	if err != nil {
		log.Printf("Error archiving old document: %v", err)
	}

	if err := tx.Commit(ctx); err != nil {
		JSONError(w, http.StatusInternalServerError, "Failed to commit renewal")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "renewed", "document", newDoc.ID, map[string]interface{}{
		"previousDocId": oldID, "type": oldDoc.DocumentType, "newExpiry": req.ExpiryDate,
	})

	result := enrichWithCompliance(&newDoc)
	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    result,
		"message": "Document renewed successfully",
	})
}

// ── Helpers ──────────────────────────────────────────────────────

func nilIntDefault(v *int, def int) int {
	if v != nil {
		return *v
	}
	return def
}

func nilFloat64Default(v *float64, def float64) float64 {
	if v != nil {
		return *v
	}
	return def
}

func nilStringDefault(v *string, def string) string {
	if v != nil {
		return *v
	}
	return def
}
