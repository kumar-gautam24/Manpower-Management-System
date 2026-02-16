package models

import "time"

// Employee represents an employee record in the database.
type Employee struct {
	ID              string    `json:"id"`
	CompanyID       string    `json:"companyId"`
	Name            string    `json:"name"`
	Trade           string    `json:"trade"`
	Mobile          string    `json:"mobile"`
	JoiningDate     string    `json:"joiningDate"`
	PhotoURL        *string   `json:"photoUrl"`
	Gender          *string   `json:"gender,omitempty"`
	DateOfBirth     *string   `json:"dateOfBirth,omitempty"`
	Nationality     *string   `json:"nationality,omitempty"`
	PassportNumber  *string   `json:"passportNumber,omitempty"`
	NativeLocation  *string   `json:"nativeLocation,omitempty"`
	CurrentLocation *string   `json:"currentLocation,omitempty"`
	Salary          *float64  `json:"salary,omitempty"`
	Status          string    `json:"status"`             // active, inactive, on_leave, terminated, resigned
	ExitType        *string   `json:"exitType,omitempty"` // resigned, terminated, absconded
	ExitDate        *string   `json:"exitDate,omitempty"`
	ExitNotes       *string   `json:"exitNotes,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// EmployeeWithCompany includes the company name alongside employee data.
// Compliance fields are aggregated across ALL mandatory documents.
type EmployeeWithCompany struct {
	Employee
	CompanyName       string  `json:"companyName"`
	CompanyCurrency   string  `json:"companyCurrency"`             // e.g. "AED", "USD"
	ComplianceStatus  string  `json:"complianceStatus"`            // "expired" | "expiring" | "valid" | "incomplete" | "none"
	NearestExpiryDays *int    `json:"nearestExpiryDays,omitempty"` // days until closest mandatory doc expiry
	DocsComplete      int     `json:"docsComplete"`                // mandatory docs with expiry_date set
	DocsTotal         int     `json:"docsTotal"`                   // total mandatory docs
	UrgentDocType     *string `json:"urgentDocType,omitempty"`     // type of the most urgent doc
	ExpiredCount      int     `json:"expiredCount"`                // how many mandatory docs are expired
	ExpiringCount     int     `json:"expiringCount"`               // how many mandatory docs are expiring soon (<=30d)
}

// CreateEmployeeRequest holds the fields needed to create an employee.
type CreateEmployeeRequest struct {
	CompanyID       string   `json:"companyId"`
	Name            string   `json:"name"`
	Trade           string   `json:"trade"`
	Mobile          string   `json:"mobile"`
	JoiningDate     string   `json:"joiningDate"`
	PhotoURL        string   `json:"photoUrl,omitempty"`
	Gender          *string  `json:"gender,omitempty"`
	DateOfBirth     *string  `json:"dateOfBirth,omitempty"`
	Nationality     *string  `json:"nationality,omitempty"`
	PassportNumber  *string  `json:"passportNumber,omitempty"`
	NativeLocation  *string  `json:"nativeLocation,omitempty"`
	CurrentLocation *string  `json:"currentLocation,omitempty"`
	Salary          *float64 `json:"salary,omitempty"`
	Status          string   `json:"status,omitempty"`
}

// UpdateEmployeeRequest holds the fields that can be updated.
type UpdateEmployeeRequest struct {
	CompanyID       *string  `json:"companyId,omitempty"`
	Name            *string  `json:"name,omitempty"`
	Trade           *string  `json:"trade,omitempty"`
	Mobile          *string  `json:"mobile,omitempty"`
	JoiningDate     *string  `json:"joiningDate,omitempty"`
	PhotoURL        *string  `json:"photoUrl,omitempty"`
	Gender          *string  `json:"gender,omitempty"`
	DateOfBirth     *string  `json:"dateOfBirth,omitempty"`
	Nationality     *string  `json:"nationality,omitempty"`
	PassportNumber  *string  `json:"passportNumber,omitempty"`
	NativeLocation  *string  `json:"nativeLocation,omitempty"`
	CurrentLocation *string  `json:"currentLocation,omitempty"`
	Salary          *float64 `json:"salary,omitempty"`
	Status          *string  `json:"status,omitempty"`
}

// ExitEmployeeRequest is used when recording an employee exit.
type ExitEmployeeRequest struct {
	ExitType  string  `json:"exitType"` // "resigned" | "terminated" | "absconded"
	ExitDate  string  `json:"exitDate"`
	ExitNotes *string `json:"exitNotes,omitempty"`
}

// Validate checks if the create request contains valid data.
func (r *CreateEmployeeRequest) Validate() map[string]string {
	errors := make(map[string]string)

	if len(r.Name) < 2 || len(r.Name) > 100 {
		errors["name"] = "Name must be between 2 and 100 characters"
	}
	if len(r.Trade) < 2 {
		errors["trade"] = "Trade is required (min 2 characters)"
	}
	if r.CompanyID == "" {
		errors["companyId"] = "Company is required"
	}
	if r.JoiningDate == "" {
		errors["joiningDate"] = "Joining date is required"
	}

	return errors
}
