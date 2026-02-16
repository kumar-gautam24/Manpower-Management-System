package models

// ── Dashboard Metrics ────────────────────────────────────────────

// DashboardMetrics holds the main dashboard statistics.
type DashboardMetrics struct {
	TotalEmployees  int `json:"totalEmployees"`
	ActiveDocuments int `json:"activeDocuments"`
	ExpiringSoon    int `json:"expiringSoon"`
	Expired         int `json:"expired"`
}

// ── Company ──────────────────────────────────────────────────────

// Company represents a company record.
type Company struct {
	ID                      string  `json:"id"`
	Name                    string  `json:"name"`
	Currency                string  `json:"currency"` // e.g. "AED", "USD"
	TradeLicenseNumber      *string `json:"tradeLicenseNumber,omitempty"`
	EstablishmentCardNumber *string `json:"establishmentCardNumber,omitempty"`
	MohreCategory           *string `json:"mohreCategory,omitempty"`       // "1", "2", "3"
	RegulatoryAuthority     *string `json:"regulatoryAuthority,omitempty"` // "MOHRE", "JAFZA", etc.
	CreatedAt               string  `json:"createdAt"`
	UpdatedAt               string  `json:"updatedAt"`
}

// CompanySummary includes employee count per company.
type CompanySummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Currency      string `json:"currency"`
	EmployeeCount int    `json:"employeeCount"`
}

// ── Expiry Alerts ────────────────────────────────────────────────

// ExpiryAlert represents a document nearing/past expiry.
type ExpiryAlert struct {
	DocumentID    string  `json:"documentId"`
	EmployeeID    string  `json:"employeeId"`
	EmployeeName  string  `json:"employeeName"`
	CompanyName   string  `json:"companyName"`
	DocumentType  string  `json:"documentType"`
	ExpiryDate    string  `json:"expiryDate"`
	DaysLeft      int     `json:"daysLeft"`
	Status        string  `json:"status"`        // "expired", "urgent", "warning", "in_grace", "penalty_active"
	EstimatedFine float64 `json:"estimatedFine"` // current fine for this document
	FinePerDay    float64 `json:"finePerDay"`    // daily rate
}

// ── Compliance Stats (new dashboard) ─────────────────────────────

// ComplianceStats provides a full compliance overview for the dashboard.
type ComplianceStats struct {
	TotalEmployees    int                 `json:"totalEmployees"`
	TotalDocuments    int                 `json:"totalDocuments"`
	DocumentsByStatus map[string]int      `json:"documentsByStatus"` // status → count
	CompletionRate    float64             `json:"completionRate"`    // percentage of docs that are not incomplete
	TotalDailyFine    float64             `json:"totalDailyFine"`    // sum of daily fine exposure
	TotalAccumulated  float64             `json:"totalAccumulated"`  // sum of all current fines
	CompanyBreakdown  []CompanyCompliance `json:"companyBreakdown"`
	CriticalAlerts    []ExpiryAlert       `json:"criticalAlerts"`
}

// CompanyCompliance is per-company compliance stats.
type CompanyCompliance struct {
	CompanyID        string  `json:"companyId"`
	CompanyName      string  `json:"companyName"`
	EmployeeCount    int     `json:"employeeCount"`
	PenaltyCount     int     `json:"penaltyCount"` // docs in penalty_active
	IncompleteCount  int     `json:"incompleteCount"`
	DailyExposure    float64 `json:"dailyExposure"` // sum of fine_per_day for active penalties
	AccumulatedFines float64 `json:"accumulatedFines"`
}

// ── Dependency Alerts ────────────────────────────────────────────

// DependencyAlert warns when a blocking document's expiry threatens
// the renewal of a dependent document.
type DependencyAlert struct {
	Severity       string `json:"severity"`    // "critical" | "warning"
	BlockingDoc    string `json:"blockingDoc"` // e.g. "passport"
	BlockedDoc     string `json:"blockedDoc"`  // e.g. "visa"
	Message        string `json:"message"`
	BlockingExpiry string `json:"blockingExpiry"`
	BlockedExpiry  string `json:"blockedExpiry"`
}
