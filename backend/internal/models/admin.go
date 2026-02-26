package models

import "encoding/json"

// ── Document Types ───────────────────────────────────────────

// DocumentType represents a configurable document type stored in the database.
type DocumentType struct {
	ID                string          `json:"id"`
	DocType           string          `json:"docType"`
	DisplayName       string          `json:"displayName"`
	IsMandatory       bool            `json:"isMandatory"`
	HasExpiry         bool            `json:"hasExpiry"`
	NumberLabel       string          `json:"numberLabel"`
	NumberPlaceholder string          `json:"numberPlaceholder"`
	ExpiryLabel       string          `json:"expiryLabel"`
	SortOrder         int             `json:"sortOrder"`
	MetadataFields    json.RawMessage `json:"metadataFields"`
	IsSystem          bool            `json:"isSystem"`
	IsActive          bool            `json:"isActive"`

	// Per-field visibility and required flags (migration 008)
	ShowDocumentNumber    bool `json:"showDocumentNumber"`
	RequireDocumentNumber bool `json:"requireDocumentNumber"`
	ShowIssueDate         bool `json:"showIssueDate"`
	RequireIssueDate      bool `json:"requireIssueDate"`
	ShowExpiryDate        bool `json:"showExpiryDate"`
	RequireExpiryDate     bool `json:"requireExpiryDate"`
	ShowFile              bool `json:"showFile"`
	RequireFile           bool `json:"requireFile"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// CreateDocumentTypeRequest is used to add a custom document type.
type CreateDocumentTypeRequest struct {
	DocType           string          `json:"docType"`
	DisplayName       string          `json:"displayName"`
	HasExpiry         bool            `json:"hasExpiry"`
	NumberLabel       string          `json:"numberLabel"`
	NumberPlaceholder string          `json:"numberPlaceholder"`
	ExpiryLabel       string          `json:"expiryLabel"`
	SortOrder         int             `json:"sortOrder"`
	MetadataFields    json.RawMessage `json:"metadataFields"`

	ShowDocumentNumber    *bool `json:"showDocumentNumber,omitempty"`
	RequireDocumentNumber *bool `json:"requireDocumentNumber,omitempty"`
	ShowIssueDate         *bool `json:"showIssueDate,omitempty"`
	RequireIssueDate      *bool `json:"requireIssueDate,omitempty"`
	ShowExpiryDate        *bool `json:"showExpiryDate,omitempty"`
	RequireExpiryDate     *bool `json:"requireExpiryDate,omitempty"`
	ShowFile              *bool `json:"showFile,omitempty"`
	RequireFile           *bool `json:"requireFile,omitempty"`
}

// Validate checks required fields for a new document type.
func (r *CreateDocumentTypeRequest) Validate() map[string]string {
	errors := map[string]string{}
	if len(r.DocType) < 2 {
		errors["docType"] = "Document type slug is required (min 2 characters)"
	}
	if len(r.DisplayName) < 2 {
		errors["displayName"] = "Display name is required (min 2 characters)"
	}
	return errors
}

// UpdateDocumentTypeRequest is used to edit an existing document type.
type UpdateDocumentTypeRequest struct {
	DisplayName       *string          `json:"displayName,omitempty"`
	NumberLabel       *string          `json:"numberLabel,omitempty"`
	NumberPlaceholder *string          `json:"numberPlaceholder,omitempty"`
	ExpiryLabel       *string          `json:"expiryLabel,omitempty"`
	SortOrder         *int             `json:"sortOrder,omitempty"`
	MetadataFields    *json.RawMessage `json:"metadataFields,omitempty"`

	ShowDocumentNumber    *bool `json:"showDocumentNumber,omitempty"`
	RequireDocumentNumber *bool `json:"requireDocumentNumber,omitempty"`
	ShowIssueDate         *bool `json:"showIssueDate,omitempty"`
	RequireIssueDate      *bool `json:"requireIssueDate,omitempty"`
	ShowExpiryDate        *bool `json:"showExpiryDate,omitempty"`
	RequireExpiryDate     *bool `json:"requireExpiryDate,omitempty"`
	ShowFile              *bool `json:"showFile,omitempty"`
	RequireFile           *bool `json:"requireFile,omitempty"`
}

// ── Compliance Rules ─────────────────────────────────────────

// ComplianceRule holds per-company (or global) fine/grace defaults.
type ComplianceRule struct {
	ID              string   `json:"id"`
	CompanyID       *string  `json:"companyId"`
	DocType         string   `json:"docType"`
	GracePeriodDays int      `json:"gracePeriodDays"`
	FinePerDay      float64  `json:"finePerDay"`
	FineType        string   `json:"fineType"`
	FineCap         float64  `json:"fineCap"`
	IsMandatory     *bool    `json:"isMandatory"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

// ComplianceRuleInput is a single rule in a bulk upsert request.
type ComplianceRuleInput struct {
	DocType         string  `json:"docType"`
	GracePeriodDays int     `json:"gracePeriodDays"`
	FinePerDay      float64 `json:"finePerDay"`
	FineType        string  `json:"fineType"`
	FineCap         float64 `json:"fineCap"`
	IsMandatory     *bool   `json:"isMandatory"`
}

// UpsertComplianceRulesRequest is the request body for bulk-upserting rules.
type UpsertComplianceRulesRequest struct {
	CompanyID *string             `json:"companyId"`
	Rules     []ComplianceRuleInput `json:"rules"`
}

// Validate checks the request has at least one rule.
func (r *UpsertComplianceRulesRequest) Validate() map[string]string {
	errors := map[string]string{}
	if len(r.Rules) == 0 {
		errors["rules"] = "At least one rule is required"
	}
	for i, rule := range r.Rules {
		if rule.DocType == "" {
			errors["rules"] = "Rule " + string(rune('0'+i)) + " is missing docType"
			break
		}
		if rule.FineType != "daily" && rule.FineType != "monthly" && rule.FineType != "one_time" {
			errors["rules"] = "Rule " + rule.DocType + " has invalid fineType"
			break
		}
	}
	return errors
}
