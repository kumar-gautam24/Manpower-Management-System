package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"manpower-backend/internal/ctxkeys"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// SalaryHandler handles salary-related HTTP requests.
type SalaryHandler struct {
	db database.Service
}

// NewSalaryHandler creates a new SalaryHandler.
func NewSalaryHandler(db database.Service) *SalaryHandler {
	return &SalaryHandler{db: db}
}

// Generate handles POST /api/salary/generate
// Creates salary records for all active employees for a given month/year.
func (h *SalaryHandler) Generate(w http.ResponseWriter, r *http.Request) {
	var req models.GenerateSalaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.Month < 1 || req.Month > 12 || req.Year < 2020 {
		JSONError(w, http.StatusBadRequest, "Invalid month or year")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Insert salary records for all active employees that have a salary set.
	// ON CONFLICT DO NOTHING — skip if record already exists for that month.
	genScopeFilter, genScopeArg := companyScopeClause(ctx, 3, "company_id")
	genArgs := []interface{}{req.Month, req.Year}
	if genScopeArg != nil {
		genArgs = append(genArgs, genScopeArg)
	}

	tag, err := pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO salary_records (employee_id, month, year, amount, status)
		SELECT id, $1, $2, salary, 'pending'
		FROM employees
		WHERE status = 'active' AND salary IS NOT NULL AND salary > 0%s
		ON CONFLICT (employee_id, month, year) DO NOTHING
	`, genScopeFilter), genArgs...)
	if err != nil {
		log.Printf("Error generating salary records: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to generate salary records")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "generated_salary", "salary", "bulk", map[string]interface{}{
		"month": req.Month, "year": req.Year, "count": tag.RowsAffected(),
	})

	JSON(w, http.StatusCreated, map[string]interface{}{
		"message":  "Salary records generated",
		"inserted": tag.RowsAffected(),
	})
}

// List handles GET /api/salary?month=X&year=Y
func (h *SalaryHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	month, _ := strconv.Atoi(q.Get("month"))
	year, _ := strconv.Atoi(q.Get("year"))
	statusFilter := q.Get("status")
	companyFilter := q.Get("company_id")

	if month < 1 || month > 12 {
		now := time.Now()
		month = int(now.Month())
		year = now.Year()
	}
	if year < 2020 {
		year = time.Now().Year()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	where := "WHERE s.month = $1 AND s.year = $2"
	args := []interface{}{month, year}
	argIdx := 3

	where, args, argIdx = appendCompanyScope(ctx, where, args, argIdx, "e.company_id")

	if statusFilter != "" && statusFilter != "all" {
		where += fmt.Sprintf(" AND s.status = $%d", argIdx)
		args = append(args, statusFilter)
		argIdx++
	}
	if companyFilter != "" {
		where += fmt.Sprintf(" AND e.company_id = $%d", argIdx)
		args = append(args, companyFilter)
		argIdx++
	}

	rows, err := pool.Query(ctx, fmt.Sprintf(`
		SELECT s.id, s.employee_id, s.month, s.year, s.amount, s.status,
			s.paid_date::text, s.notes,
			s.created_at::text, s.updated_at::text,
			e.name, c.name, COALESCE(c.currency, 'AED')
		FROM salary_records s
		JOIN employees e ON s.employee_id = e.id
		JOIN companies c ON e.company_id = c.id
		%s
		ORDER BY e.name ASC
	`, where), args...)
	if err != nil {
		log.Printf("Error fetching salary records: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch salary records")
		return
	}
	defer rows.Close()

	records := []models.SalaryRecordWithEmployee{}
	for rows.Next() {
		var rec models.SalaryRecordWithEmployee
		if err := rows.Scan(
			&rec.ID, &rec.EmployeeID, &rec.Month, &rec.Year, &rec.Amount, &rec.Status,
			&rec.PaidDate, &rec.Notes,
			&rec.CreatedAt, &rec.UpdatedAt,
			&rec.EmployeeName, &rec.CompanyName, &rec.Currency,
		); err != nil {
			log.Printf("Error scanning salary record: %v", err)
			continue
		}
		records = append(records, rec)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": records,
	})
}

// UpdateStatus handles PATCH /api/salary/{id}/status — quick toggle
func (h *SalaryHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		JSONError(w, http.StatusBadRequest, "Salary record ID is required")
		return
	}

	if !checkSalaryAccess(r.Context(), h.db.GetPool(), id) {
		JSONError(w, http.StatusForbidden, "Access denied to this salary record")
		return
	}

	var req models.UpdateSalaryStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	validStatuses := map[string]bool{"pending": true, "paid": true, "partial": true}
	if !validStatuses[req.Status] {
		JSONError(w, http.StatusBadRequest, "Status must be pending, paid, or partial")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Set paid_date when marking as paid, clear it otherwise
	paidDateExpr := "NULL"
	if req.Status == "paid" {
		paidDateExpr = "CURRENT_DATE"
	}

	var rec models.SalaryRecord
	err := pool.QueryRow(ctx, fmt.Sprintf(`
		UPDATE salary_records 
		SET status = $1, paid_date = %s, updated_at = NOW()
		WHERE id = $2
		RETURNING id, employee_id, month, year, amount, status,
			paid_date::text, notes, created_at::text, updated_at::text
	`, paidDateExpr), req.Status, id).Scan(
		&rec.ID, &rec.EmployeeID, &rec.Month, &rec.Year, &rec.Amount, &rec.Status,
		&rec.PaidDate, &rec.Notes, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		log.Printf("Error updating salary status %s: %v", id, err)
		JSONError(w, http.StatusNotFound, "Salary record not found")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "updated_status", "salary", id, map[string]interface{}{
		"status": req.Status,
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":    rec,
		"message": "Status updated",
	})
}

// BulkUpdateStatus handles PATCH /api/salary/bulk-status
func (h *SalaryHandler) BulkUpdateStatus(w http.ResponseWriter, r *http.Request) {
	var req models.BulkUpdateSalaryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if len(req.IDs) == 0 {
		JSONError(w, http.StatusBadRequest, "At least one ID is required")
		return
	}

	validStatuses := map[string]bool{"pending": true, "paid": true, "partial": true}
	if !validStatuses[req.Status] {
		JSONError(w, http.StatusBadRequest, "Status must be pending, paid, or partial")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Build IN clause
	placeholders := make([]string, len(req.IDs))
	args := []interface{}{req.Status}
	for i, id := range req.IDs {
		placeholders[i] = fmt.Sprintf("$%d", i+2)
		args = append(args, id)
	}

	paidDateExpr := "NULL"
	if req.Status == "paid" {
		paidDateExpr = "CURRENT_DATE"
	}

	scope := ctxkeys.GetCompanyScope(r.Context())
	scopeJoin := ""
	if scope != nil {
		scopeJoin = fmt.Sprintf(` AND employee_id IN (SELECT id FROM employees WHERE company_id = ANY($%d))`, len(args)+1)
		args = append(args, scope)
	}

	query := fmt.Sprintf(`
		UPDATE salary_records 
		SET status = $1, paid_date = %s, updated_at = NOW()
		WHERE id IN (%s)%s
	`, paidDateExpr, strings.Join(placeholders, ", "), scopeJoin)

	tag, err := pool.Exec(ctx, query, args...)
	if err != nil {
		log.Printf("Error bulk updating salary: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to bulk update")
		return
	}

	// Audit trail
	userID, _ := r.Context().Value(ctxkeys.UserID).(string)
	logActivity(pool, userID, "bulk_updated_status", "salary", "bulk", map[string]interface{}{
		"status": req.Status, "count": tag.RowsAffected(),
	})

	JSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("Updated %d records", tag.RowsAffected()),
		"updated": tag.RowsAffected(),
	})
}

// Summary handles GET /api/salary/summary?month=X&year=Y
func (h *SalaryHandler) Summary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	month, _ := strconv.Atoi(q.Get("month"))
	year, _ := strconv.Atoi(q.Get("year"))

	if month < 1 || month > 12 {
		now := time.Now()
		month = int(now.Month())
		year = now.Year()
	}
	if year < 2020 {
		year = time.Now().Year()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Calculate summary
	// Note: Summing amounts of different currencies is conceptually wrong,
	// but for this MVP we just sum raw values. Ideally frontend should warn if "Mixed".
	sumScopeFilter, sumScopeArg := companyScopeClause(ctx, 3, "e.company_id")
	sumArgs := []interface{}{month, year}
	if sumScopeArg != nil {
		sumArgs = append(sumArgs, sumScopeArg)
	}

	var summary models.SalarySummary
	err := pool.QueryRow(ctx, fmt.Sprintf(`
		WITH stats AS (
			SELECT
				COALESCE(SUM(s.amount), 0) as total_amount,
				COALESCE(SUM(CASE WHEN s.status = 'paid' THEN s.amount ELSE 0 END), 0) as paid_amount,
				count(CASE WHEN s.status = 'pending' THEN 1 END) as pending_count,
				count(CASE WHEN s.status = 'paid' THEN 1 END) as paid_count,
				count(CASE WHEN s.status = 'partial' THEN 1 END) as partial_count,
				count(*) as total_count,
				count(DISTINCT c.currency) as currency_count,
				MAX(c.currency) as single_currency
			FROM salary_records s
			JOIN employees e ON s.employee_id = e.id
			JOIN companies c ON e.company_id = c.id
			WHERE s.month = $1 AND s.year = $2%s
		)
		SELECT total_amount, paid_amount, pending_count, paid_count, partial_count, total_count,
			CASE WHEN currency_count > 1 THEN 'Mixed' ELSE COALESCE(single_currency, 'AED') END as currency
		FROM stats
	`, sumScopeFilter), sumArgs...).Scan(
		&summary.TotalAmount, &summary.PaidAmount,
		&summary.PendingCount, &summary.PaidCount, &summary.PartialCount, &summary.TotalCount,
		&summary.Currency,
	)
	if err != nil {
		log.Printf("Error fetching salary summary: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch summary")
		return
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": summary,
	})
}

// Export handles GET /api/salary/export?month=X&year=Y — returns CSV
func (h *SalaryHandler) Export(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	month, _ := strconv.Atoi(q.Get("month"))
	year, _ := strconv.Atoi(q.Get("year"))

	if month < 1 || month > 12 {
		now := time.Now()
		month = int(now.Month())
		year = now.Year()
	}
	if year < 2020 {
		year = time.Now().Year()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	expScopeFilter, expScopeArg := companyScopeClause(ctx, 3, "e.company_id")
	expArgs := []interface{}{month, year}
	if expScopeArg != nil {
		expArgs = append(expArgs, expScopeArg)
	}

	rows, err := pool.Query(ctx, fmt.Sprintf(`
		SELECT e.name, c.name, COALESCE(c.currency, 'AED'), s.amount, s.status,
			COALESCE(s.paid_date::text, ''), COALESCE(s.notes, '')
		FROM salary_records s
		JOIN employees e ON s.employee_id = e.id
		JOIN companies c ON e.company_id = c.id
		WHERE s.month = $1 AND s.year = $2%s
		ORDER BY e.name ASC
	`, expScopeFilter), expArgs...)
	if err != nil {
		log.Printf("Error exporting salary: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to export")
		return
	}
	defer rows.Close()

	filename := fmt.Sprintf("salary_%d_%02d.csv", year, month)
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)

	fmt.Fprintln(w, "Employee,Company,Currency,Amount,Status,Paid Date,Notes")

	for rows.Next() {
		var name, company, currency, status, paidDate, notes string
		var amount float64
		if err := rows.Scan(&name, &company, &currency, &amount, &status, &paidDate, &notes); err != nil {
			continue
		}
		fmt.Fprintf(w, "%s,%s,%s,%.2f,%s,%s,%s\n",
			csvEscape(name), csvEscape(company), csvEscape(currency), amount, status, paidDate, csvEscape(notes))
	}
}

// ListByEmployee handles GET /api/employees/{id}/salary
// Returns all salary records for a specific employee, ordered newest first.
func (h *SalaryHandler) ListByEmployee(w http.ResponseWriter, r *http.Request) {
	employeeID := chi.URLParam(r, "id")
	if employeeID == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	if !checkEmployeeAccess(r.Context(), h.db.GetPool(), employeeID) {
		JSONError(w, http.StatusForbidden, "Access denied to this employee")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT s.id, s.employee_id, s.month, s.year, s.amount, s.status,
			COALESCE(s.paid_date::text, ''), COALESCE(s.notes, ''),
			s.created_at::text, s.updated_at::text,
			c.name, COALESCE(c.currency, 'AED')
		FROM salary_records s
		JOIN employees e ON s.employee_id = e.id
		JOIN companies c ON e.company_id = c.id
		WHERE s.employee_id = $1
		ORDER BY s.year DESC, s.month DESC
	`, employeeID)
	if err != nil {
		log.Printf("Error fetching salary for employee %s: %v", employeeID, err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch salary records")
		return
	}
	defer rows.Close()

	records := []models.SalaryRecordWithEmployee{}
	for rows.Next() {
		var rec models.SalaryRecordWithEmployee
		if err := rows.Scan(
			&rec.ID, &rec.EmployeeID, &rec.Month, &rec.Year, &rec.Amount, &rec.Status,
			&rec.PaidDate, &rec.Notes,
			&rec.CreatedAt, &rec.UpdatedAt,
			&rec.CompanyName, &rec.Currency,
		); err != nil {
			log.Printf("Error scanning salary record: %v", err)
			continue
		}
		records = append(records, rec)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":  records,
		"total": len(records),
	})
}
