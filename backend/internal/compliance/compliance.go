// Package compliance provides pure functions for UAE document compliance
// calculations. These functions have ZERO dependencies on HTTP, database, or
// any other infrastructure — making them trivially testable and reusable.
package compliance

import (
	"math"
	"strings"
	"time"
)

// ── Document Status Constants ────────────────────────────────────
// Status is always computed from (expiryDate, graceDays, docNumber, now).
// It is never stored in the database.

const (
	StatusIncomplete    = "incomplete"     // Missing document_number or expiry_date
	StatusValid         = "valid"          // Expiry > 30 days from now
	StatusExpiringSoon  = "expiring_soon"  // Expiry within 30 days
	StatusInGrace       = "in_grace"       // Expired but within grace period
	StatusPenaltyActive = "penalty_active" // Past grace — fines accumulating
)

// ── Fine Type Constants ──────────────────────────────────────────

const (
	FineTypeDaily   = "daily"
	FineTypeMonthly = "monthly"
	FineTypeOneTime = "one_time"
)

// ── Mandatory Document Configuration ─────────────────────────────
// These defaults are seeded when a new employee is created.
// Grace periods: ONLY Emirates ID (30d) and Work Permit/Labour Card (50d).

// MandatoryDocConfig defines the default fine/grace for a mandatory document type.
type MandatoryDocConfig struct {
	DocType         string
	DisplayName     string
	GracePeriodDays int
	FinePerDay      float64
	FineType        string
	FineCap         float64
}

// MandatoryDocs lists the 5 mandatory UAE employee document types
// with their default fine schedules. Used as a fallback when the
// document_types table is empty.
var MandatoryDocs = []MandatoryDocConfig{
	{DocType: "passport", DisplayName: "Passport", GracePeriodDays: 0, FinePerDay: 0, FineType: FineTypeDaily, FineCap: 0},
	{DocType: "visa", DisplayName: "Residence Visa", GracePeriodDays: 0, FinePerDay: 50, FineType: FineTypeDaily, FineCap: 0},
	{DocType: "emirates_id", DisplayName: "Emirates ID", GracePeriodDays: 30, FinePerDay: 20, FineType: FineTypeDaily, FineCap: 1000},
	{DocType: "work_permit", DisplayName: "Work Permit / Labour Card", GracePeriodDays: 50, FinePerDay: 500, FineType: FineTypeOneTime, FineCap: 500},
	{DocType: "iloe_insurance", DisplayName: "ILOE Insurance", GracePeriodDays: 0, FinePerDay: 400, FineType: FineTypeOneTime, FineCap: 400},
}

// MandatoryDocCount is a convenience constant.
const MandatoryDocCount = 5

// displayNames maps doc type slugs to human-readable names for non-mandatory types.
var displayNames = map[string]string{
	"health_insurance": "Health Insurance",
	"medical_fitness":  "Medical Fitness Certificate",
	"trade_license":    "Trade License",
}

// ── Status Computation ───────────────────────────────────────────

// ComputeStatus derives the compliance status of a document.
// Parameters:
//   - expiryDate: the document's expiry date (nil → incomplete)
//   - graceDays:  grace period in days after expiry before fines start
//   - docNumber:  the document identification number (empty → incomplete)
//   - now:        current time (injected for testability)
func ComputeStatus(expiryDate *time.Time, graceDays int, docNumber string, now time.Time) string {
	// No expiry date at all → incomplete (empty doc slot)
	if expiryDate == nil {
		return StatusIncomplete
	}

	today := truncateToDay(now)
	expiry := truncateToDay(*expiryDate)
	daysUntilExpiry := int(expiry.Sub(today).Hours() / 24)

	// Severity-first: check penalty/grace/expiring BEFORE incomplete.
	// A doc with an expiry date that's past is in penalty even if doc number is missing.
	switch {
	case daysUntilExpiry <= 0 && (graceDays == 0 || -daysUntilExpiry > graceDays):
		// Past grace period (or no grace period) — penalties apply
		return StatusPenaltyActive
	case daysUntilExpiry <= 0 && graceDays > 0 && -daysUntilExpiry <= graceDays:
		// Expired but within grace window
		return StatusInGrace
	case daysUntilExpiry > 0 && daysUntilExpiry <= 30:
		return StatusExpiringSoon
	}

	// Not in any severity state — check if doc number is missing
	if docNumber == "" {
		return StatusIncomplete
	}
	return StatusValid
}

// ── Fine Calculation ─────────────────────────────────────────────

// ComputeFine calculates the estimated accumulated fine for a document.
// Returns 0 if the document is not in penalty_active status.
// Parameters:
//   - expiryDate: when the document expired
//   - graceDays:  grace period (fine starts AFTER grace ends)
//   - finePerDay: the fine rate (daily amount, monthly amount, or one-time flat)
//   - fineType:   "daily" | "monthly" | "one_time"
//   - fineCap:    maximum fine (0 = uncapped)
//   - now:        current time
func ComputeFine(expiryDate time.Time, graceDays int, finePerDay float64, fineType string, fineCap float64, now time.Time) float64 {
	if finePerDay <= 0 {
		return 0
	}

	today := truncateToDay(now)
	expiry := truncateToDay(expiryDate)

	// Penalty starts after expiry + grace period
	penaltyStart := expiry.AddDate(0, 0, graceDays)
	if today.Before(penaltyStart) || today.Equal(penaltyStart) {
		return 0
	}

	daysInPenalty := int(today.Sub(penaltyStart).Hours() / 24)
	if daysInPenalty <= 0 {
		return 0
	}

	var fine float64
	switch fineType {
	case FineTypeDaily:
		fine = float64(daysInPenalty) * finePerDay
	case FineTypeMonthly:
		monthsInPenalty := math.Ceil(float64(daysInPenalty) / 30.0)
		fine = monthsInPenalty * finePerDay
	case FineTypeOneTime:
		fine = finePerDay // Flat fee, regardless of duration
	default:
		fine = float64(daysInPenalty) * finePerDay
	}

	// Apply cap if set
	if fineCap > 0 && fine > fineCap {
		fine = fineCap
	}

	return math.Round(fine*100) / 100 // Round to 2 decimal places
}

// ── Helper Computations ──────────────────────────────────────────

// DaysRemaining returns the number of days until expiry.
// Positive = days left, negative = days overdue, nil = no expiry set.
func DaysRemaining(expiryDate *time.Time, now time.Time) *int {
	if expiryDate == nil {
		return nil
	}
	days := int(truncateToDay(*expiryDate).Sub(truncateToDay(now)).Hours() / 24)
	return &days
}

// GraceDaysRemaining returns remaining grace days.
// Only meaningful when status is "in_grace", otherwise returns nil.
func GraceDaysRemaining(expiryDate *time.Time, graceDays int, now time.Time) *int {
	if expiryDate == nil || graceDays <= 0 {
		return nil
	}

	today := truncateToDay(now)
	graceEnd := truncateToDay(*expiryDate).AddDate(0, 0, graceDays)

	if today.Before(truncateToDay(*expiryDate)) || today.After(graceEnd) {
		return nil // Not in grace period
	}

	remaining := int(graceEnd.Sub(today).Hours() / 24)
	return &remaining
}

// DaysInPenalty returns the number of days past the grace period.
// Only meaningful when status is "penalty_active", otherwise returns nil.
func DaysInPenalty(expiryDate *time.Time, graceDays int, now time.Time) *int {
	if expiryDate == nil {
		return nil
	}

	today := truncateToDay(now)
	penaltyStart := truncateToDay(*expiryDate).AddDate(0, 0, graceDays)

	if today.Before(penaltyStart) || today.Equal(penaltyStart) {
		return nil
	}

	days := int(today.Sub(penaltyStart).Hours() / 24)
	return &days
}

// DisplayName returns the human-readable name for a document type.
func DisplayName(docType string) string {
	for _, md := range MandatoryDocs {
		if md.DocType == docType {
			return md.DisplayName
		}
	}
	if name, ok := displayNames[docType]; ok {
		return name
	}
	if docType == "" {
		return "Document"
	}
	words := strings.Split(strings.ReplaceAll(docType, "_", " "), " ")
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// IsMandatoryType checks if a document type is in the mandatory list.
func IsMandatoryType(docType string) bool {
	for _, md := range MandatoryDocs {
		if md.DocType == docType {
			return true
		}
	}
	return false
}

// ── Internal Helpers ─────────────────────────────────────────────

// truncateToDay strips the time component, keeping only the date.
func truncateToDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
