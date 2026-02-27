package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"manpower-backend/internal/compliance"
	"manpower-backend/internal/ctxkeys"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// EmployeeHandler handles employee-related HTTP requests.
type EmployeeHandler struct {
	db database.Service
}

// NewEmployeeHandler creates a new EmployeeHandler.
func NewEmployeeHandler(db database.Service) *EmployeeHandler {
	return &EmployeeHandler{db: db}
}

// ── Columns ────────────────────────────────────────────────────
// Central column lists keep Create/GetByID/List all in sync.
// Aliased version (for SELECT with FROM clause):
const employeeCols = `e.id, e.company_id, e.name, e.trade, e.mobile,
	e.joining_date::text, e.photo_url,
	e.gender, e.date_of_birth::text, e.nationality, e.passport_number,
	e.native_location, e.current_location, e.salary, e.status,
	e.exit_type, e.exit_date::text, e.exit_notes,
	e.created_at, e.updated_at`

// Unaliased version (for INSERT/UPDATE RETURNING):
const employeeRetCols = `id, company_id, name, trade, mobile,
	joining_date::text, photo_url,
	gender, date_of_birth::text, nationality, passport_number,
	native_location, current_location, salary, status,
	exit_type, exit_date::text, exit_notes,
	created_at, updated_at`

// ── Scan Helpers ───────────────────────────────────────────────

func scanEmployee(scanner interface {
	Scan(dest ...interface{}) error
}, emp *models.Employee) error {
	return scanner.Scan(
		&emp.ID, &emp.CompanyID, &emp.Name, &emp.Trade, &emp.Mobile,
		&emp.JoiningDate, &emp.PhotoURL,
		&emp.Gender, &emp.DateOfBirth, &emp.Nationality, &emp.PassportNumber,
		&emp.NativeLocation, &emp.CurrentLocation, &emp.Salary, &emp.Status,
		&emp.ExitType, &emp.ExitDate, &emp.ExitNotes,
		&emp.CreatedAt, &emp.UpdatedAt,
	)
}

func scanEmployeeWithCompany(scanner interface {
	Scan(dest ...interface{}) error
}, emp *models.EmployeeWithCompany) error {
	return scanner.Scan(
		&emp.ID, &emp.CompanyID, &emp.Name, &emp.Trade, &emp.Mobile,
		&emp.JoiningDate, &emp.PhotoURL,
		&emp.Gender, &emp.DateOfBirth, &emp.Nationality, &emp.PassportNumber,
		&emp.NativeLocation, &emp.CurrentLocation, &emp.Salary, &emp.Status,
		&emp.ExitType, &emp.ExitDate, &emp.ExitNotes,
		&emp.CreatedAt, &emp.UpdatedAt,
		&emp.CompanyName, &emp.CompanyCurrency,
		&emp.ComplianceStatus, &emp.NearestExpiryDays,
		&emp.DocsComplete, &emp.DocsTotal, &emp.UrgentDocType,
		&emp.ExpiredCount, &emp.ExpiringCount,
	)
}

// ── Create ─────────────────────────────────────────────────────

// Create handles POST /api/employees
// After inserting the employee, it auto-creates mandatory document
// slots (from document_types table) so that compliance posture is immediately visible.
func (h *EmployeeHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req models.CreateEmployeeRequest
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

	// Default status to "active" if not provided
	if req.Status == "" {
		req.Status = "active"
	}

	if !checkCompanyAccess(r.Context(), req.CompanyID) {
		JSONError(w, http.StatusForbidden, "Access denied to this company")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Use a transaction: insert employee + mandatory doc slots
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create employee")
		return
	}
	defer tx.Rollback(ctx)

	// 1. Insert the employee
	var employee models.Employee
	err = tx.QueryRow(ctx, `
		INSERT INTO employees (
			company_id, name, trade, mobile, joining_date, photo_url,
			gender, date_of_birth, nationality, passport_number,
			native_location, current_location, salary, status
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING `+employeeRetCols,
		req.CompanyID, req.Name, req.Trade, req.Mobile, req.JoiningDate,
		nilIfEmpty(req.PhotoURL),
		req.Gender, req.DateOfBirth, req.Nationality, req.PassportNumber,
		req.NativeLocation, req.CurrentLocation, req.Salary, req.Status,
	).Scan(
		&employee.ID, &employee.CompanyID, &employee.Name,
		&employee.Trade, &employee.Mobile, &employee.JoiningDate,
		&employee.PhotoURL,
		&employee.Gender, &employee.DateOfBirth, &employee.Nationality, &employee.PassportNumber,
		&employee.NativeLocation, &employee.CurrentLocation, &employee.Salary, &employee.Status,
		&employee.ExitType, &employee.ExitDate, &employee.ExitNotes,
		&employee.CreatedAt, &employee.UpdatedAt,
	)
	if err != nil {
		log.Printf("Error creating employee: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create employee")
		return
	}

	// 2. Auto-create mandatory document slots from DB (falls back to hardcoded if DB empty)
	mandatoryRows, mandErr := tx.Query(ctx, `
		SELECT dt.doc_type
		FROM document_types dt
		LEFT JOIN compliance_rules cr ON cr.doc_type = dt.doc_type AND cr.company_id = $1
		WHERE dt.is_active = TRUE
		  AND COALESCE(cr.is_mandatory, dt.is_mandatory) = TRUE
		ORDER BY dt.sort_order
	`, req.CompanyID)

	var mandatoryDocTypes []string

	if mandErr == nil {
		defer mandatoryRows.Close()
		for mandatoryRows.Next() {
			var docType string
			if err := mandatoryRows.Scan(&docType); err != nil {
				log.Printf("Error scanning mandatory doc type: %v", err)
				continue
			}
			mandatoryDocTypes = append(mandatoryDocTypes, docType)
		}
	}

	// Fallback: if DB tables are empty or query failed, use hardcoded defaults
	if len(mandatoryDocTypes) == 0 {
		for _, md := range compliance.MandatoryDocs {
			mandatoryDocTypes = append(mandatoryDocTypes, md.DocType)
		}
	}

	for _, docType := range mandatoryDocTypes {
		_, err := tx.Exec(ctx, `
			INSERT INTO documents (
				employee_id, document_type, is_primary,
				file_url, file_name, file_size, file_type
			)
			VALUES ($1, $2, FALSE, '', '', 0, '')
		`, employee.ID, docType)
		if err != nil {
			log.Printf("Error creating mandatory doc slot %s for employee %s: %v",
				docType, employee.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("Error committing employee creation: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to create employee")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "created", "employee", employee.ID, map[string]interface{}{
		"name": employee.Name, "trade": employee.Trade,
	})

	JSON(w, http.StatusCreated, map[string]interface{}{
		"data":    employee,
		"message": "Employee created successfully",
	})
}

// ── List ───────────────────────────────────────────────────────

// List handles GET /api/employees
func (h *EmployeeHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	companyID := q.Get("company_id")
	trade := q.Get("trade")
	search := q.Get("search")
	docStatus := q.Get("status")     // document status filter
	empStatus := q.Get("emp_status") // employee active/inactive filter
	nationality := q.Get("nationality")
	sortBy := q.Get("sort_by")
	sortOrder := q.Get("sort_order")

	// Whitelist allowed sort columns
	allowedSorts := map[string]string{
		"name":         "e.name",
		"joining_date": "e.joining_date",
		"created_at":   "e.created_at",
		"salary":       "e.salary",
	}
	sortCol, ok := allowedSorts[sortBy]
	if !ok {
		sortCol = "e.name"
	}
	if sortOrder != "desc" {
		sortOrder = "asc"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Build dynamic WHERE clause
	where := "WHERE 1=1"
	args := []interface{}{}
	argIdx := 1

	// Company scope (role-based)
	where, args, argIdx = appendCompanyScope(ctx, where, args, argIdx, "e.company_id")

	if companyID != "" {
		where += fmt.Sprintf(" AND e.company_id = $%d", argIdx)
		args = append(args, companyID)
		argIdx++
	}
	if trade != "" {
		where += fmt.Sprintf(" AND e.trade = $%d", argIdx)
		args = append(args, trade)
		argIdx++
	}
	if search != "" {
		where += fmt.Sprintf(" AND e.name ILIKE $%d", argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}
	if empStatus != "" {
		where += fmt.Sprintf(" AND e.status = $%d", argIdx)
		args = append(args, empStatus)
		argIdx++
	}
	if nationality != "" {
		where += fmt.Sprintf(" AND e.nationality ILIKE $%d", argIdx)
		args = append(args, "%"+nationality+"%")
		argIdx++
	}

	// Doc status filter — uses the compliance status from LATERAL subquery
	var statusFilter string
	switch docStatus {
	case "expiring", "expiring_soon":
		statusFilter = " AND ds.compliance_status = 'expiring_soon'"
	case "expired", "penalty_active":
		statusFilter = " AND ds.compliance_status = 'penalty_active'"
	case "in_grace":
		statusFilter = " AND ds.compliance_status = 'in_grace'"
	case "valid", "active":
		statusFilter = " AND ds.compliance_status = 'valid'"
	case "incomplete":
		statusFilter = " AND ds.compliance_status = 'incomplete'"
	}

	// Count total for pagination
	// Per-document status hierarchy (severity-first):
	//   penalty_active = expired AND past grace period
	//   in_grace       = expired but within grace period
	//   expiring_soon  = within 30 days of expiry
	//   incomplete     = missing expiry_date or document_number
	//   valid          = all docs have expiry > 30 days
	//   none           = no mandatory docs at all
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM employees e
		LEFT JOIN LATERAL (
			SELECT
				CASE
					WHEN COUNT(*) = 0 THEN 'none'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') < CURRENT_DATE) > 0 THEN 'penalty_active'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') >= CURRENT_DATE) > 0 THEN 'in_grace'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date >= CURRENT_DATE AND d2.expiry_date <= CURRENT_DATE + INTERVAL '30 days') > 0 THEN 'expiring_soon'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NULL OR d2.document_number IS NULL OR d2.document_number = '') > 0 THEN 'incomplete'
					ELSE 'valid'
				END AS compliance_status
			FROM documents d2
			LEFT JOIN document_types dt2 ON dt2.doc_type = d2.document_type AND dt2.is_active = TRUE
			LEFT JOIN compliance_rules cr2 ON cr2.doc_type = d2.document_type AND cr2.company_id = e.company_id
			LEFT JOIN compliance_rules gr2 ON gr2.doc_type = d2.document_type AND gr2.company_id IS NULL
			WHERE d2.employee_id = e.id AND COALESCE(dt2.is_mandatory, FALSE) = TRUE
		) ds ON TRUE
		%s %s
	`, where, statusFilter)
	var total int
	if err := pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		log.Printf("Error counting employees: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch employees")
		return
	}

	// Fetch employees — compliance aggregated across ALL mandatory docs
	query := fmt.Sprintf(`
		SELECT 
			%s,
			c.name AS company_name,
			COALESCE(c.currency, 'AED') AS company_currency,
			ds.compliance_status,
			ds.nearest_expiry_days,
			ds.docs_complete,
			ds.docs_total,
			ds.urgent_doc_type,
			ds.expired_count,
			ds.expiring_count
		FROM employees e
		JOIN companies c ON e.company_id = c.id
		LEFT JOIN LATERAL (
			SELECT
				CASE
					WHEN COUNT(*) = 0 THEN 'none'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') < CURRENT_DATE) > 0 THEN 'penalty_active'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') >= CURRENT_DATE) > 0 THEN 'in_grace'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date >= CURRENT_DATE AND d2.expiry_date <= CURRENT_DATE + INTERVAL '30 days') > 0 THEN 'expiring_soon'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NULL OR d2.document_number IS NULL OR d2.document_number = '') > 0 THEN 'incomplete'
					ELSE 'valid'
				END AS compliance_status,
				MIN(d2.expiry_date) - CURRENT_DATE AS nearest_expiry_days,
				COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.document_number IS NOT NULL AND d2.document_number != '')::int AS docs_complete,
				COUNT(*)::int AS docs_total,
				(SELECT dd.document_type FROM documents dd
				 LEFT JOIN document_types ddt ON ddt.doc_type = dd.document_type AND ddt.is_active = TRUE
				 WHERE dd.employee_id = e.id AND COALESCE(ddt.is_mandatory, FALSE) = TRUE
				   AND dd.expiry_date IS NOT NULL
				 ORDER BY dd.expiry_date ASC LIMIT 1
				) AS urgent_doc_type,
				COUNT(*) FILTER (WHERE d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') < CURRENT_DATE)::int AS expired_count,
				COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date >= CURRENT_DATE AND d2.expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_count
			FROM documents d2
			LEFT JOIN document_types dt2 ON dt2.doc_type = d2.document_type AND dt2.is_active = TRUE
			LEFT JOIN compliance_rules cr2 ON cr2.doc_type = d2.document_type AND cr2.company_id = e.company_id
			LEFT JOIN compliance_rules gr2 ON gr2.doc_type = d2.document_type AND gr2.company_id IS NULL
			WHERE d2.employee_id = e.id AND COALESCE(dt2.is_mandatory, FALSE) = TRUE
		) ds ON TRUE
		%s %s
		ORDER BY %s %s
		LIMIT $%d OFFSET $%d
	`, employeeCols, where, statusFilter, sortCol, sortOrder, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		log.Printf("Error querying employees: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch employees")
		return
	}
	defer rows.Close()

	employees := []models.EmployeeWithCompany{}
	for rows.Next() {
		var emp models.EmployeeWithCompany
		if err := scanEmployeeWithCompany(rows, &emp); err != nil {
			log.Printf("Error scanning employee: %v", err)
			continue
		}
		employees = append(employees, emp)
	}

	JSON(w, http.StatusOK, PaginatedResponse{
		Data: employees,
		Pagination: PaginationMeta{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: int(math.Ceil(float64(total) / float64(limit))),
		},
	})
}

// ── GetByID ────────────────────────────────────────────────────

// GetByID handles GET /api/employees/{id}
// Returns employee profile + all documents with computed compliance.
func (h *EmployeeHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	var emp models.EmployeeWithCompany
	err := pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT 
			%s,
			c.name AS company_name,
			COALESCE(c.currency, 'AED') AS company_currency,
			ds.compliance_status,
			ds.nearest_expiry_days,
			ds.docs_complete,
			ds.docs_total,
			ds.urgent_doc_type,
			ds.expired_count,
			ds.expiring_count
		FROM employees e
		JOIN companies c ON e.company_id = c.id
		LEFT JOIN LATERAL (
			SELECT
				CASE
					WHEN COUNT(*) = 0 THEN 'none'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') < CURRENT_DATE) > 0 THEN 'penalty_active'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') >= CURRENT_DATE) > 0 THEN 'in_grace'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date >= CURRENT_DATE AND d2.expiry_date <= CURRENT_DATE + INTERVAL '30 days') > 0 THEN 'expiring_soon'
					WHEN COUNT(*) FILTER (WHERE d2.expiry_date IS NULL OR d2.document_number IS NULL OR d2.document_number = '') > 0 THEN 'incomplete'
					ELSE 'valid'
				END AS compliance_status,
				MIN(d2.expiry_date) - CURRENT_DATE AS nearest_expiry_days,
				COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.document_number IS NOT NULL AND d2.document_number != '')::int AS docs_complete,
				COUNT(*)::int AS docs_total,
				(SELECT dd.document_type FROM documents dd
				 LEFT JOIN document_types ddt ON ddt.doc_type = dd.document_type AND ddt.is_active = TRUE
				 WHERE dd.employee_id = e.id AND COALESCE(ddt.is_mandatory, FALSE) = TRUE
				   AND dd.expiry_date IS NOT NULL
				 ORDER BY dd.expiry_date ASC LIMIT 1
				) AS urgent_doc_type,
				COUNT(*) FILTER (WHERE d2.expiry_date < CURRENT_DATE AND (d2.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, 0) * INTERVAL '1 day') < CURRENT_DATE)::int AS expired_count,
				COUNT(*) FILTER (WHERE d2.expiry_date IS NOT NULL AND d2.expiry_date >= CURRENT_DATE AND d2.expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_count
			FROM documents d2
			LEFT JOIN document_types dt2 ON dt2.doc_type = d2.document_type AND dt2.is_active = TRUE
			LEFT JOIN compliance_rules cr2 ON cr2.doc_type = d2.document_type AND cr2.company_id = e.company_id
			LEFT JOIN compliance_rules gr2 ON gr2.doc_type = d2.document_type AND gr2.company_id IS NULL
			WHERE d2.employee_id = e.id AND COALESCE(dt2.is_mandatory, FALSE) = TRUE
		) ds ON TRUE
		WHERE e.id = $1
	`, employeeCols), id,
	).Scan(
		&emp.ID, &emp.CompanyID, &emp.Name, &emp.Trade, &emp.Mobile,
		&emp.JoiningDate, &emp.PhotoURL,
		&emp.Gender, &emp.DateOfBirth, &emp.Nationality, &emp.PassportNumber,
		&emp.NativeLocation, &emp.CurrentLocation, &emp.Salary, &emp.Status,
		&emp.ExitType, &emp.ExitDate, &emp.ExitNotes,
		&emp.CreatedAt, &emp.UpdatedAt,
		&emp.CompanyName, &emp.CompanyCurrency,
		&emp.ComplianceStatus, &emp.NearestExpiryDays,
		&emp.DocsComplete, &emp.DocsTotal, &emp.UrgentDocType,
		&emp.ExpiredCount, &emp.ExpiringCount,
	)
	if err != nil {
		log.Printf("Error fetching employee %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Employee not found")
		return
	}

	if !checkCompanyAccess(r.Context(), emp.CompanyID) {
		JSONError(w, http.StatusForbidden, "Access denied to this employee")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": emp,
	})
}

// ── Exit ───────────────────────────────────────────────────────

// Exit handles PATCH /api/employees/{id}/exit
// Records an employee exit (resignation, termination, absconsion).
func (h *EmployeeHandler) Exit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	if !checkEmployeeAccess(r.Context(), h.db.GetPool(), id) {
		JSONError(w, http.StatusForbidden, "Access denied to this employee")
		return
	}

	var req models.ExitEmployeeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	// Validate exit type
	validExitTypes := map[string]bool{"resigned": true, "terminated": true, "absconded": true}
	if !validExitTypes[req.ExitType] {
		JSONError(w, http.StatusUnprocessableEntity, "Exit type must be 'resigned', 'terminated', or 'absconded'")
		return
	}
	if req.ExitDate == "" {
		JSONError(w, http.StatusUnprocessableEntity, "Exit date is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Map exit type to employee status
	statusMap := map[string]string{
		"resigned":   "resigned",
		"terminated": "terminated",
		"absconded":  "terminated",
	}

	var employee models.Employee
	err := pool.QueryRow(ctx, `
		UPDATE employees SET
			status = $1, exit_type = $2, exit_date = $3, exit_notes = $4,
			updated_at = NOW()
		WHERE id = $5
		RETURNING `+employeeRetCols,
		statusMap[req.ExitType], req.ExitType, req.ExitDate, req.ExitNotes, id,
	).Scan(
		&employee.ID, &employee.CompanyID, &employee.Name,
		&employee.Trade, &employee.Mobile, &employee.JoiningDate,
		&employee.PhotoURL,
		&employee.Gender, &employee.DateOfBirth, &employee.Nationality, &employee.PassportNumber,
		&employee.NativeLocation, &employee.CurrentLocation, &employee.Salary, &employee.Status,
		&employee.ExitType, &employee.ExitDate, &employee.ExitNotes,
		&employee.CreatedAt, &employee.UpdatedAt,
	)
	if err != nil {
		log.Printf("Error recording employee exit %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Employee not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "exited", "employee", employee.ID, map[string]interface{}{
		"name": employee.Name, "exitType": req.ExitType,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    employee,
		"message": "Employee exit recorded successfully",
	})
}

// ── Update ─────────────────────────────────────────────────────

// Update handles PUT /api/employees/{id}
func (h *EmployeeHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	if !checkEmployeeAccess(r.Context(), h.db.GetPool(), id) {
		JSONError(w, http.StatusForbidden, "Access denied to this employee")
		return
	}

	var req models.UpdateEmployeeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Build dynamic SET clause — only update provided fields
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	addField := func(col string, val interface{}) {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", col, argIdx))
		args = append(args, val)
		argIdx++
	}

	if req.Name != nil {
		addField("name", *req.Name)
	}
	if req.Trade != nil {
		addField("trade", *req.Trade)
	}
	if req.CompanyID != nil {
		addField("company_id", *req.CompanyID)
	}
	if req.Mobile != nil {
		addField("mobile", *req.Mobile)
	}
	if req.JoiningDate != nil {
		addField("joining_date", *req.JoiningDate)
	}
	if req.PhotoURL != nil {
		addField("photo_url", *req.PhotoURL)
	}
	if req.Gender != nil {
		addField("gender", *req.Gender)
	}
	if req.DateOfBirth != nil {
		addField("date_of_birth", *req.DateOfBirth)
	}
	if req.Nationality != nil {
		addField("nationality", *req.Nationality)
	}
	if req.PassportNumber != nil {
		addField("passport_number", *req.PassportNumber)
	}
	if req.NativeLocation != nil {
		addField("native_location", *req.NativeLocation)
	}
	if req.CurrentLocation != nil {
		addField("current_location", *req.CurrentLocation)
	}
	if req.Salary != nil {
		addField("salary", *req.Salary)
	}
	if req.Status != nil {
		addField("status", *req.Status)
	}

	if len(setClauses) == 0 {
		JSONError(w, http.StatusBadRequest, "No fields to update")
		return
	}

	// Always update updated_at
	setClauses = append(setClauses, "updated_at = NOW()")

	query := fmt.Sprintf(`
		UPDATE employees SET %s
		WHERE id = $%d
		RETURNING %s
	`, strings.Join(setClauses, ", "), argIdx, employeeRetCols)
	args = append(args, id)

	var employee models.Employee
	if err := scanEmployee(pool.QueryRow(ctx, query, args...), &employee); err != nil {
		log.Printf("Error updating employee %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Employee not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "updated", "employee", employee.ID, map[string]interface{}{
		"name": employee.Name,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    employee,
		"message": "Employee updated successfully",
	})
}

// ── Delete ─────────────────────────────────────────────────────

// Delete handles DELETE /api/employees/{id}
func (h *EmployeeHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	if !checkEmployeeAccess(r.Context(), h.db.GetPool(), id) {
		JSONError(w, http.StatusForbidden, "Access denied to this employee")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	tag, err := pool.Exec(ctx, "DELETE FROM employees WHERE id = $1", id)
	if err != nil {
		log.Printf("Error deleting employee %s: %v", id, err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete employee")
		return
	}

	if tag.RowsAffected() == 0 {
		JSONError(w, http.StatusNotFound, "Employee not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "deleted", "employee", id, nil)

	JSON(w, http.StatusOK, map[string]string{
		"message": "Employee deleted successfully",
	})
}

// ── BatchDelete ────────────────────────────────────────────────

// BatchDelete handles POST /api/employees/batch-delete
// Accepts { "ids": ["uuid1", "uuid2", ...] } and deletes all matching employees.
func (h *EmployeeHandler) BatchDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if len(req.IDs) == 0 {
		JSONError(w, http.StatusBadRequest, "No employee IDs provided")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	scope := ctxkeys.GetCompanyScope(r.Context())
	var tag interface{ RowsAffected() int64 }
	var err error
	if scope == nil {
		tag, err = pool.Exec(ctx, "DELETE FROM employees WHERE id = ANY($1::uuid[])", req.IDs)
	} else {
		tag, err = pool.Exec(ctx, "DELETE FROM employees WHERE id = ANY($1::uuid[]) AND company_id = ANY($2)", req.IDs, scope)
	}
	if err != nil {
		log.Printf("Error batch deleting employees: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to delete employees")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	for _, id := range req.IDs {
		logActivity(pool, userID, "deleted", "employee", id, nil)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("%d employee(s) deleted successfully", tag.RowsAffected()),
		"deleted": tag.RowsAffected(),
	})
}

// ── Export ──────────────────────────────────────────────────────

// Export handles GET /api/employees/export — returns CSV
func (h *EmployeeHandler) Export(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	where := "WHERE 1=1"
	exportArgs := []interface{}{}
	exportArgIdx := 1
	where, exportArgs, exportArgIdx = appendCompanyScope(ctx, where, exportArgs, exportArgIdx, "e.company_id")
	_ = exportArgIdx

	rows, err := pool.Query(ctx, fmt.Sprintf(`
		SELECT e.name, e.trade, e.mobile, e.joining_date::text,
			COALESCE(e.gender,''), COALESCE(e.nationality,''),
			COALESCE(e.passport_number,''), COALESCE(e.native_location,''),
			COALESCE(e.current_location,''), COALESCE(e.salary::text,''),
			e.status, c.name
		FROM employees e
		JOIN companies c ON e.company_id = c.id
		%s
		ORDER BY e.name ASC
	`, where), exportArgs...)
	if err != nil {
		log.Printf("Error exporting employees: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to export")
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=employees.csv")

	// Write CSV header
	fmt.Fprintln(w, "Name,Trade,Mobile,Joining Date,Gender,Nationality,Passport,Native Location,Current Location,Salary,Status,Company")

	for rows.Next() {
		var name, trade, mobile, joiningDate, gender, nationality, passport, nativeLoc, currentLoc, salary, status, company string
		if err := rows.Scan(&name, &trade, &mobile, &joiningDate, &gender, &nationality, &passport, &nativeLoc, &currentLoc, &salary, &status, &company); err != nil {
			continue
		}
		fmt.Fprintf(w, "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
			csvEscape(name), csvEscape(trade), csvEscape(mobile), joiningDate,
			gender, nationality, passport,
			csvEscape(nativeLoc), csvEscape(currentLoc), salary, status, csvEscape(company))
	}
}

// ── Helpers ────────────────────────────────────────────────────

// nilIfEmpty returns nil if the string is empty, otherwise returns a pointer to it.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// csvEscape wraps a value in quotes if it contains commas.
func csvEscape(s string) string {
	if strings.Contains(s, ",") || strings.Contains(s, "\"") {
		return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
	}
	return s
}
