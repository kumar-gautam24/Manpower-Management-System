package handlers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"manpower-backend/internal/ctxkeys"
)

// appendCompanyScope adds a company_id scope filter to a dynamic WHERE clause.
// colExpr is the SQL column expression to filter on (e.g. "e.company_id", "c.id").
// If the user has global scope (admin/super_admin), nothing is added.
func appendCompanyScope(ctx context.Context, where string, args []interface{}, argIdx int, colExpr string) (string, []interface{}, int) {
	scope := ctxkeys.GetCompanyScope(ctx)
	if scope == nil {
		return where, args, argIdx
	}
	where += fmt.Sprintf(" AND %s = ANY($%d)", colExpr, argIdx)
	args = append(args, scope)
	argIdx++
	return where, args, argIdx
}

// companyScopeClause returns a standalone SQL clause and arg for use in
// queries that don't use the dynamic WHERE builder.
// Returns ("", nil) for global scope (no filtering needed).
func companyScopeClause(ctx context.Context, argIdx int, colExpr string) (string, interface{}) {
	scope := ctxkeys.GetCompanyScope(ctx)
	if scope == nil {
		return "", nil
	}
	return fmt.Sprintf(" AND %s = ANY($%d)", colExpr, argIdx), scope
}

// checkCompanyAccess verifies that the given companyID is within the user's scope.
func checkCompanyAccess(ctx context.Context, companyID string) bool {
	scope := ctxkeys.GetCompanyScope(ctx)
	if scope == nil {
		return true
	}
	for _, id := range scope {
		if id == companyID {
			return true
		}
	}
	return false
}

// checkDocumentAccess looks up the document's employee → company and checks scope.
func checkDocumentAccess(ctx context.Context, pool *pgxpool.Pool, documentID string) bool {
	if ctxkeys.IsGlobalScope(ctx) {
		return true
	}
	var companyID string
	err := pool.QueryRow(ctx,
		"SELECT e.company_id::text FROM documents d JOIN employees e ON e.id = d.employee_id WHERE d.id = $1",
		documentID,
	).Scan(&companyID)
	if err != nil {
		return false
	}
	return checkCompanyAccess(ctx, companyID)
}

// checkSalaryAccess looks up the salary record's employee → company and checks scope.
func checkSalaryAccess(ctx context.Context, pool *pgxpool.Pool, salaryID string) bool {
	if ctxkeys.IsGlobalScope(ctx) {
		return true
	}
	var companyID string
	err := pool.QueryRow(ctx,
		"SELECT e.company_id::text FROM salary_records s JOIN employees e ON e.id = s.employee_id WHERE s.id = $1",
		salaryID,
	).Scan(&companyID)
	if err != nil {
		return false
	}
	return checkCompanyAccess(ctx, companyID)
}

// checkEmployeeAccess looks up the employee's company_id and checks scope.
func checkEmployeeAccess(ctx context.Context, pool *pgxpool.Pool, employeeID string) bool {
	if ctxkeys.IsGlobalScope(ctx) {
		return true
	}
	var companyID string
	err := pool.QueryRow(ctx, "SELECT company_id::text FROM employees WHERE id = $1", employeeID).Scan(&companyID)
	if err != nil {
		return false
	}
	return checkCompanyAccess(ctx, companyID)
}
