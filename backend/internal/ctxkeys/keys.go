// Package ctxkeys defines typed context keys shared between middleware and handlers.
// This avoids import cycles: both middleware and handlers import this package,
// but neither imports the other for context key types.
package ctxkeys

import "context"

// Key is a typed string used as context key to prevent collisions.
type Key string

const (
	UserID       Key = "userID"
	UserRole     Key = "userRole"
	CompanyScope Key = "companyScope"
)

// GetCompanyScope returns the list of company IDs the current user has access to.
// Returns nil for admin/super_admin (meaning "all companies").
func GetCompanyScope(ctx context.Context) []string {
	v := ctx.Value(CompanyScope)
	if v == nil {
		return nil
	}
	ids, _ := v.([]string)
	return ids
}

// IsGlobalScope returns true if the user has access to all companies (admin/super_admin).
func IsGlobalScope(ctx context.Context) bool {
	return ctx.Value(CompanyScope) == nil
}

// ValidRoles lists all valid role strings.
var ValidRoles = map[string]bool{
	"viewer":        true,
	"company_owner": true,
	"admin":         true,
	"super_admin":   true,
}

// RoleLevel maps role names to permission levels.
var RoleLevel = map[string]int{
	"viewer":        1,
	"company_owner": 2,
	"admin":         3,
	"super_admin":   4,
}
