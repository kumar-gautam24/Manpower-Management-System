package cron

import (
	"context"
	"fmt"
	"log"
	"time"

	"manpower-backend/internal/compliance"
	"manpower-backend/internal/database"
)

// StartNotifier launches a background goroutine that runs once per day
// (and once immediately) to generate compliance notifications for all
// users who own companies with expiring or non-compliant documents.
func StartNotifier(db database.Service) {
	go func() {
		runCycle(db)

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			runCycle(db)
		}
	}()

	log.Println("[cron] compliance notifier started – runs every 24 h")
}

// runCycle queries documents that need attention and inserts a notification
// for each relevant user. Notifications are de-duplicated by
// (user_id, entity_type, entity_id) on the same day.
func runCycle(db database.Service) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool := db.GetPool()
	now := time.Now()

	// ─── 1. Fetch documents expiring within 30 days or already expired ───
	rows, err := pool.Query(ctx, `
		SELECT
			d.id, d.employee_id, d.document_type, d.expiry_date,
			COALESCE(cr.grace_period_days, gr.grace_period_days, d.grace_period_days) AS grace_period_days,
			COALESCE(cr.fine_per_day, gr.fine_per_day, d.fine_per_day) AS fine_per_day,
			d.document_number,
			COALESCE(cr.fine_type, gr.fine_type, d.fine_type) AS fine_type,
			COALESCE(cr.fine_cap, gr.fine_cap, d.fine_cap) AS fine_cap,
			e.name AS employee_name,
			c.name AS company_name,
			u.id   AS user_id
		FROM documents d
		JOIN employees e ON d.employee_id = e.id
		JOIN companies c ON e.company_id  = c.id
		JOIN users     u ON c.user_id     = u.id
		LEFT JOIN compliance_rules cr ON cr.doc_type = d.document_type AND cr.company_id = e.company_id
		LEFT JOIN compliance_rules gr ON gr.doc_type = d.document_type AND gr.company_id IS NULL
		WHERE d.expiry_date IS NOT NULL
		  AND d.expiry_date <= (NOW() + INTERVAL '30 days')
		  AND d.file_url    IS NOT NULL
		  AND d.file_url    != ''
	`)
	if err != nil {
		log.Printf("[cron] error querying documents: %v", err)
		return
	}
	defer rows.Close()

	type alertRow struct {
		DocID       string
		EmpID       string
		DocType     string
		ExpiryDate  time.Time
		GraceDays   int
		FinePerDay  float64
		DocNumber   *string
		FineType    string
		FineCap     float64
		EmpName     string
		CompanyName string
		UserID      string
	}

	var alerts []alertRow
	for rows.Next() {
		var a alertRow
		if err := rows.Scan(
			&a.DocID, &a.EmpID, &a.DocType, &a.ExpiryDate,
			&a.GraceDays, &a.FinePerDay, &a.DocNumber,
			&a.FineType, &a.FineCap,
			&a.EmpName, &a.CompanyName, &a.UserID,
		); err != nil {
			log.Printf("[cron] scan error: %v", err)
			continue
		}
		alerts = append(alerts, a)
	}

	if len(alerts) == 0 {
		log.Println("[cron] no expiring / expired documents found")
		return
	}

	// ─── 2. Build & insert notifications (skip if already sent today) ────
	inserted := 0
	today := now.Format("2006-01-02")

	for _, a := range alerts {
		expiry := a.ExpiryDate // copy so we can take its address
		docNum := ""
		if a.DocNumber != nil {
			docNum = *a.DocNumber
		}

		status := compliance.ComputeStatus(&expiry, a.GraceDays, docNum, now)
		daysRemPtr := compliance.DaysRemaining(&expiry, now)

		daysRem := 0
		if daysRemPtr != nil {
			daysRem = *daysRemPtr
		}

		var title, message, nType string
		switch status {
		case compliance.StatusPenaltyActive:
			fine := compliance.ComputeFine(expiry, a.GraceDays, a.FinePerDay, a.FineType, a.FineCap, now)
			title = fmt.Sprintf("🚨 %s – PENALTY ACTIVE", a.DocType)
			message = fmt.Sprintf(
				"%s (%s): %s expired %d days ago. Estimated fine: %.0f AED.",
				a.EmpName, a.CompanyName, a.DocType, -daysRem, fine,
			)
			nType = "document_penalty"

		case compliance.StatusInGrace:
			graceRemPtr := compliance.GraceDaysRemaining(&expiry, a.GraceDays, now)
			graceRem := 0
			if graceRemPtr != nil {
				graceRem = *graceRemPtr
			}
			title = fmt.Sprintf("⚠️ %s – In Grace Period", a.DocType)
			message = fmt.Sprintf(
				"%s (%s): %s grace period active. Renew within %d days to avoid fines.",
				a.EmpName, a.CompanyName, a.DocType, graceRem,
			)
			nType = "document_grace"

		case compliance.StatusExpiringSoon:
			title = fmt.Sprintf("📋 %s – Expiring Soon", a.DocType)
			message = fmt.Sprintf(
				"%s (%s): %s expires in %d days. Please renew promptly.",
				a.EmpName, a.CompanyName, a.DocType, daysRem,
			)
			nType = "document_expiring"

		default:
			continue // valid or incomplete docs – no notification needed
		}

		// De-duplicate: skip if we already sent a notification for this
		// exact document + user today.
		var exists bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM notifications
				WHERE user_id     = $1
				  AND entity_type = 'document'
				  AND entity_id   = $2
				  AND created_at::date = $3::date
			)
		`, a.UserID, a.DocID, today).Scan(&exists)

		if exists {
			continue
		}

		_, err := pool.Exec(ctx, `
			INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id)
			VALUES ($1, $2, $3, $4, 'document', $5)
		`, a.UserID, title, message, nType, a.DocID)
		if err != nil {
			log.Printf("[cron] insert notification error: %v", err)
			continue
		}
		inserted++
	}

	log.Printf("[cron] compliance check complete – %d new notifications from %d alerts", inserted, len(alerts))
}
