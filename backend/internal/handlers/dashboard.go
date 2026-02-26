package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"manpower-backend/internal/compliance"
	"manpower-backend/internal/database"
	"manpower-backend/internal/models"
)

// DashboardHandler handles dashboard-related HTTP requests.
type DashboardHandler struct {
	db database.Service
}

// NewDashboardHandler creates a new DashboardHandler.
func NewDashboardHandler(db database.Service) *DashboardHandler {
	return &DashboardHandler{db: db}
}

// ── GetMetrics ─────────────────────────────────────────────────

// GetMetrics handles GET /api/dashboard/metrics
func (h *DashboardHandler) GetMetrics(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	metrics := models.DashboardMetrics{}

	// Exclude exited employees for consistency with compliance stats
	err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM employees WHERE exit_type IS NULL").Scan(&metrics.TotalEmployees)
	if err != nil {
		log.Printf("Error querying total employees: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch metrics")
		return
	}

	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM documents d
		JOIN employees e ON d.employee_id = e.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE AND d.expiry_date IS NOT NULL
		  AND d.expiry_date > CURRENT_DATE + INTERVAL '30 days'
		  AND e.exit_type IS NULL
	`).Scan(&metrics.ActiveDocuments)
	if err != nil {
		log.Printf("Error querying active documents: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch metrics")
		return
	}

	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM documents d
		JOIN employees e ON d.employee_id = e.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE AND d.expiry_date IS NOT NULL
		  AND d.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
		  AND e.exit_type IS NULL
	`).Scan(&metrics.ExpiringSoon)
	if err != nil {
		log.Printf("Error querying expiring soon: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch metrics")
		return
	}

	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM documents d
		JOIN employees e ON d.employee_id = e.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		LEFT JOIN compliance_rules cr ON cr.doc_type = d.document_type AND cr.company_id = e.company_id
		LEFT JOIN compliance_rules gr ON gr.doc_type = d.document_type AND gr.company_id IS NULL
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE AND d.expiry_date IS NOT NULL
		  AND d.expiry_date < CURRENT_DATE
		  AND (d.expiry_date + COALESCE(cr.grace_period_days, gr.grace_period_days, d.grace_period_days) * INTERVAL '1 day') < CURRENT_DATE
		  AND e.exit_type IS NULL
	`).Scan(&metrics.Expired)
	if err != nil {
		log.Printf("Error querying expired: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch metrics")
		return
	}

	JSON(w, http.StatusOK, metrics)
}

// ── GetExpiryAlerts ────────────────────────────────────────────

// GetExpiryAlerts handles GET /api/dashboard/expiring
func (h *DashboardHandler) GetExpiryAlerts(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT
			d.id, e.id, e.name, c.name, d.document_type,
			d.expiry_date::text,
			(d.expiry_date - CURRENT_DATE) AS days_left,
			COALESCE(cr.grace_period_days, gr.grace_period_days, d.grace_period_days) AS grace_period_days,
			COALESCE(cr.fine_per_day, gr.fine_per_day, d.fine_per_day) AS fine_per_day,
			COALESCE(cr.fine_type, gr.fine_type, d.fine_type) AS fine_type,
			COALESCE(cr.fine_cap, gr.fine_cap, d.fine_cap) AS fine_cap,
			d.document_number
		FROM documents d
		JOIN employees e ON d.employee_id = e.id
		JOIN companies c ON e.company_id = c.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		LEFT JOIN compliance_rules cr ON cr.doc_type = d.document_type AND cr.company_id = e.company_id
		LEFT JOIN compliance_rules gr ON gr.doc_type = d.document_type AND gr.company_id IS NULL
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE AND d.expiry_date IS NOT NULL
		  AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
		  AND e.exit_type IS NULL
		ORDER BY d.expiry_date ASC
	`)
	if err != nil {
		log.Printf("Error fetching expiry alerts: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch alerts")
		return
	}
	defer rows.Close()

	now := time.Now()
	alerts := []models.ExpiryAlert{}
	for rows.Next() {
		var a models.ExpiryAlert
		var graceDays int
		var finePerDay, fineCap float64
		var fineType string
		var docNumber *string

		if err := rows.Scan(
			&a.DocumentID, &a.EmployeeID, &a.EmployeeName,
			&a.CompanyName, &a.DocumentType, &a.ExpiryDate,
			&a.DaysLeft,
			&graceDays, &finePerDay, &fineType, &fineCap,
			&docNumber,
		); err != nil {
			log.Printf("Error scanning alert: %v", err)
			continue
		}

		// Use the compliance engine for accurate status (in_grace vs penalty_active)
		if expiryTime, parseErr := time.Parse("2006-01-02", a.ExpiryDate); parseErr == nil {
			docNum := ""
			if docNumber != nil {
				docNum = *docNumber
			}
			a.Status = compliance.ComputeStatus(&expiryTime, graceDays, docNum, now)
			a.EstimatedFine = compliance.ComputeFine(expiryTime, graceDays, finePerDay, fineType, fineCap, now)
			a.GraceDaysRemaining = compliance.GraceDaysRemaining(&expiryTime, graceDays, now)
			a.DaysInPenalty = compliance.DaysInPenalty(&expiryTime, graceDays, now)
		}
		a.FinePerDay = finePerDay

		alerts = append(alerts, a)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data":  alerts,
		"total": len(alerts),
	})
}

// ── GetCompanySummary ──────────────────────────────────────────

// GetCompanySummary handles GET /api/dashboard/company-summary
func (h *DashboardHandler) GetCompanySummary(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name, COALESCE(c.currency, 'AED'), COUNT(e.id) AS employee_count
		FROM companies c
		LEFT JOIN employees e ON e.company_id = c.id
		GROUP BY c.id, c.name, c.currency
		ORDER BY employee_count DESC
	`)
	if err != nil {
		log.Printf("Error fetching company summary: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch company summary")
		return
	}
	defer rows.Close()

	companies := []models.CompanySummary{}
	for rows.Next() {
		var cs models.CompanySummary
		if err := rows.Scan(&cs.ID, &cs.Name, &cs.Currency, &cs.EmployeeCount); err != nil {
			log.Printf("Error scanning company summary: %v", err)
			continue
		}
		companies = append(companies, cs)
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": companies,
	})
}

// ── GetComplianceStats ─────────────────────────────────────────

// GetComplianceStats handles GET /api/dashboard/compliance
// Returns comprehensive compliance overview: fine exposure, completion rates,
// per-company breakdown, and critical alerts.
func (h *DashboardHandler) GetComplianceStats(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pool := h.db.GetPool()
	now := time.Now()

	stats := models.ComplianceStats{
		DocumentsByStatus: make(map[string]int),
	}

	// Total employees (excluding exited)
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM employees WHERE exit_type IS NULL`).Scan(&stats.TotalEmployees)

	pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM documents d
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE
	`).Scan(&stats.TotalDocuments)

	rows, err := pool.Query(ctx, `
		SELECT d.document_number, d.expiry_date::text,
			COALESCE(cr.grace_period_days, gr.grace_period_days, d.grace_period_days) AS grace_period_days,
			COALESCE(cr.fine_per_day, gr.fine_per_day, d.fine_per_day) AS fine_per_day,
			COALESCE(cr.fine_type, gr.fine_type, d.fine_type) AS fine_type,
			COALESCE(cr.fine_cap, gr.fine_cap, d.fine_cap) AS fine_cap,
			d.file_url
		FROM documents d
		JOIN employees e ON d.employee_id = e.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		LEFT JOIN compliance_rules cr ON cr.doc_type = d.document_type AND cr.company_id = e.company_id
		LEFT JOIN compliance_rules gr ON gr.doc_type = d.document_type AND gr.company_id IS NULL
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE AND e.exit_type IS NULL
	`)
	if err != nil {
		log.Printf("Error fetching compliance stats: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch compliance stats")
		return
	}
	defer rows.Close()

	totalComplete := 0
	for rows.Next() {
		var docNumber *string
		var expiryRaw string
		var graceDays int
		var finePerDay, fineCap float64
		var fineType, fileURL string

		if err := rows.Scan(&docNumber, &expiryRaw, &graceDays, &finePerDay, &fineType, &fineCap, &fileURL); err != nil {
			continue
		}

		// Compute status
		var expiryTime *time.Time
		if expiryRaw != "" {
			if t, err := time.Parse("2006-01-02", expiryRaw); err == nil {
				expiryTime = &t
			}
		}
		docNum := ""
		if docNumber != nil {
			docNum = *docNumber
		}
		status := compliance.ComputeStatus(expiryTime, graceDays, docNum, now)
		stats.DocumentsByStatus[status]++

		if status != compliance.StatusIncomplete {
			totalComplete++
		}

		// Accumulate fines
		if expiryTime != nil && status == compliance.StatusPenaltyActive {
			fine := compliance.ComputeFine(*expiryTime, graceDays, finePerDay, fineType, fineCap, now)
			stats.TotalAccumulated += fine
			// Only add to daily exposure for actual daily-type fines
			if fineType == compliance.FineTypeDaily {
				stats.TotalDailyFine += finePerDay
			}
		}
	}

	// Completion rate
	if stats.TotalDocuments > 0 {
		stats.CompletionRate = float64(totalComplete) / float64(stats.TotalDocuments) * 100
	}

	companyRows, err := pool.Query(ctx, `
		SELECT c.id, c.name, COUNT(DISTINCT e.id) AS emp_count,
			COUNT(d.id) FILTER (WHERE d.expiry_date IS NOT NULL 
				AND d.expiry_date < CURRENT_DATE
				AND (d.expiry_date + COALESCE(cr2.grace_period_days, gr2.grace_period_days, d.grace_period_days) * INTERVAL '1 day') < CURRENT_DATE
			) AS penalty_count,
			COUNT(d.id) FILTER (WHERE d.document_number IS NULL 
				OR d.document_number = ''
				OR d.expiry_date IS NULL
			) AS incomplete_count
		FROM companies c
		LEFT JOIN employees e ON e.company_id = c.id AND e.exit_type IS NULL
		LEFT JOIN documents d ON d.employee_id = e.id
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		LEFT JOIN compliance_rules cr2 ON cr2.doc_type = d.document_type AND cr2.company_id = c.id
		LEFT JOIN compliance_rules gr2 ON gr2.doc_type = d.document_type AND gr2.company_id IS NULL
		WHERE COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE OR d.id IS NULL
		GROUP BY c.id, c.name
		ORDER BY penalty_count DESC
	`)
	if err == nil {
		defer companyRows.Close()
		for companyRows.Next() {
			var cc models.CompanyCompliance
			if err := companyRows.Scan(
				&cc.CompanyID, &cc.CompanyName, &cc.EmployeeCount,
				&cc.PenaltyCount, &cc.IncompleteCount,
			); err != nil {
				continue
			}
			stats.CompanyBreakdown = append(stats.CompanyBreakdown, cc)
		}
	}

	JSON(w, http.StatusOK, stats)
}

// ── GetDependencyAlerts ────────────────────────────────────────

// GetDependencyAlerts handles GET /api/employees/{id}/dependency-alerts
// Returns warnings when a blocking document's expiry threatens the
// renewal of a dependent document.
func (h *DashboardHandler) GetDependencyAlerts(w http.ResponseWriter, r *http.Request) {
	employeeID := chi.URLParam(r, "id")
	if employeeID == "" {
		JSONError(w, http.StatusBadRequest, "Employee ID is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	pool := h.db.GetPool()

	// Fetch dependency rules
	depRows, err := pool.Query(ctx, `SELECT blocking_doc_type, blocked_doc_type, description FROM document_dependencies`)
	if err != nil {
		log.Printf("Error fetching dependencies: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch dependency alerts")
		return
	}
	defer depRows.Close()

	type dep struct {
		Blocking    string
		Blocked     string
		Description string
	}
	deps := []dep{}
	for depRows.Next() {
		var d dep
		if err := depRows.Scan(&d.Blocking, &d.Blocked, &d.Description); err != nil {
			continue
		}
		deps = append(deps, d)
	}

	docRows, err := pool.Query(ctx, `
		SELECT d.document_type, COALESCE(d.expiry_date::text, ''), d.document_number
		FROM documents d
		LEFT JOIN document_types dt ON dt.doc_type = d.document_type AND dt.is_active = TRUE
		WHERE d.employee_id = $1 AND COALESCE(dt.is_mandatory, d.is_mandatory) = TRUE
	`, employeeID)
	if err != nil {
		log.Printf("Error fetching employee docs for dependency check: %v", err)
		JSONError(w, http.StatusInternalServerError, "Failed to fetch dependency alerts")
		return
	}
	defer docRows.Close()

	// Map doc type → expiry date string
	docExpiry := map[string]string{}
	docExists := map[string]bool{}
	for docRows.Next() {
		var docType, expiry string
		var docNumber *string
		if err := docRows.Scan(&docType, &expiry, &docNumber); err != nil {
			continue
		}
		docExpiry[docType] = expiry
		docExists[docType] = docNumber != nil && *docNumber != ""
	}

	// Evaluate dependency rules
	now := time.Now()
	alerts := []models.DependencyAlert{}
	for _, d := range deps {
		blockingExpiry := docExpiry[d.Blocking]
		blockedExpiry := docExpiry[d.Blocked]

		// Skip if blocking doc has no expiry set
		if blockingExpiry == "" {
			continue
		}

		blockingTime, err := time.Parse("2006-01-02", blockingExpiry)
		if err != nil {
			continue
		}

		daysUntilBlockingExpiry := int(blockingTime.Sub(now).Hours() / 24)

		alert := models.DependencyAlert{
			BlockingDoc:    d.Blocking,
			BlockedDoc:     d.Blocked,
			Message:        d.Description,
			BlockingExpiry: blockingExpiry,
			BlockedExpiry:  blockedExpiry,
		}

		if daysUntilBlockingExpiry < 0 {
			alert.Severity = "critical"
			alert.Message = fmt.Sprintf("%s has EXPIRED — %s", compliance.DisplayName(d.Blocking), d.Description)
			alerts = append(alerts, alert)
		} else if daysUntilBlockingExpiry <= 30 {
			alert.Severity = "warning"
			alert.Message = fmt.Sprintf("%s expires in %d days — %s",
				compliance.DisplayName(d.Blocking), daysUntilBlockingExpiry, d.Description)
			alerts = append(alerts, alert)
		}
	}

	JSON(w, http.StatusOK, map[string]interface{}{
		"data": alerts,
	})
}
