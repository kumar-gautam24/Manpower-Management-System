package models

import (
	"encoding/json"
	"time"
)

// ── Core Document ────────────────────────────────────────────────

// Document represents a document record in the database.
type Document struct {
	ID              string          `json:"id"`
	EmployeeID      string          `json:"employeeId"`
	DocumentType    string          `json:"documentType"`
	DocumentNumber  *string         `json:"documentNumber"`  // e.g. visa UID, EID number
	IssueDate       *string         `json:"issueDate"`       // when the document was issued
	ExpiryDate      *string         `json:"expiryDate"`      // nullable — nil means no expiry set yet
	GracePeriodDays int             `json:"gracePeriodDays"` // days after expiry before fine starts
	FinePerDay      float64         `json:"finePerDay"`      // fine rate
	FineType        string          `json:"fineType"`        // "daily" | "monthly" | "one_time"
	FineCap         float64         `json:"fineCap"`         // max fine (0 = uncapped)
	IsPrimary       bool            `json:"isPrimary"`       // legacy — kept for backward compat
	IsMandatory     bool            `json:"isMandatory"`     // true for the 7 mandatory UAE doc types
	Metadata        json.RawMessage `json:"metadata"`        // type-specific fields (JSONB)
	FileURL         string          `json:"fileUrl"`
	FileName        string          `json:"fileName"`
	FileSize        int64           `json:"fileSize"`
	FileType        string          `json:"fileType"`
	LastUpdated     time.Time       `json:"lastUpdated"`
	CreatedAt       time.Time       `json:"createdAt"`
}

// ── Document with Computed Compliance Fields ─────────────────────

// DocumentWithCompliance extends Document with status and fine info
// that are COMPUTED on every read — never stored in the database.
type DocumentWithCompliance struct {
	Document

	// Computed compliance fields
	Status             string  `json:"status"`                       // "incomplete" | "valid" | "expiring_soon" | "in_grace" | "penalty_active"
	DisplayName        string  `json:"displayName"`                  // Human-readable type name
	EstimatedFine      float64 `json:"estimatedFine"`                // Current accumulated fine (AED)
	DaysRemaining      *int    `json:"daysRemaining,omitempty"`      // Days until expiry (negative = overdue)
	GraceDaysRemaining *int    `json:"graceDaysRemaining,omitempty"` // Remaining grace days (only when in_grace)
	DaysInPenalty      *int    `json:"daysInPenalty,omitempty"`      // Days past grace (only when penalty_active)
}

// ── Document with Employee context (for single-doc lookups) ──────

// DocumentWithEmployee includes the employee and company name.
type DocumentWithEmployee struct {
	Document
	EmployeeName string `json:"employeeName"`
	CompanyName  string `json:"companyName"`
}

// ── Create / Update Requests ─────────────────────────────────────

// CreateDocumentRequest holds the fields for creating a new document.
type CreateDocumentRequest struct {
	DocumentType    string          `json:"documentType"`
	DocumentNumber  *string         `json:"documentNumber,omitempty"`
	IssueDate       *string         `json:"issueDate,omitempty"`
	ExpiryDate      *string         `json:"expiryDate,omitempty"`
	GracePeriodDays *int            `json:"gracePeriodDays,omitempty"`
	FinePerDay      *float64        `json:"finePerDay,omitempty"`
	FineType        *string         `json:"fineType,omitempty"`
	FineCap         *float64        `json:"fineCap,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	FileURL         string          `json:"fileUrl"`
	FileName        string          `json:"fileName"`
	FileSize        int64           `json:"fileSize"`
	FileType        string          `json:"fileType"`
}

// UpdateDocumentRequest holds the fields that can be partially updated.
type UpdateDocumentRequest struct {
	DocumentType    *string         `json:"documentType,omitempty"`
	DocumentNumber  *string         `json:"documentNumber,omitempty"`
	IssueDate       *string         `json:"issueDate,omitempty"`
	ExpiryDate      *string         `json:"expiryDate,omitempty"`
	GracePeriodDays *int            `json:"gracePeriodDays,omitempty"`
	FinePerDay      *float64        `json:"finePerDay,omitempty"`
	FineType        *string         `json:"fineType,omitempty"`
	FineCap         *float64        `json:"fineCap,omitempty"`
	IsPrimary       *bool           `json:"isPrimary,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	FileURL         *string         `json:"fileUrl,omitempty"`
	FileName        *string         `json:"fileName,omitempty"`
	FileSize        *int64          `json:"fileSize,omitempty"`
	FileType        *string         `json:"fileType,omitempty"`
}

// Validate checks if the create request contains valid data.
func (r *CreateDocumentRequest) Validate() map[string]string {
	errors := make(map[string]string)

	if len(r.DocumentType) < 2 {
		errors["documentType"] = "Document type is required (min 2 characters)"
	}
	// File fields are only required for non-mandatory (ad-hoc) documents.
	// Mandatory slots are created without files initially.

	return errors
}
