package models

// User represents an authenticated user in the system.
// Each user owns companies and their employees/documents.
type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"` // Never expose in JSON responses
	Name         string `json:"name"`
	Role         string `json:"role"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// RegisterRequest contains the fields needed to create a new account.
// All new users are registered as "viewer". Admin role is granted via User Management.
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// UpdateRoleRequest is used by admins to change a user's role.
type UpdateRoleRequest struct {
	Role string `json:"role"`
}

// Validate checks that the role is one of the allowed values.
func (r *UpdateRoleRequest) Validate() map[string]string {
	errors := map[string]string{}
	valid := map[string]bool{"viewer": true, "company_owner": true, "admin": true, "super_admin": true}
	if !valid[r.Role] {
		errors["role"] = "Role must be 'viewer', 'company_owner', 'admin', or 'super_admin'"
	}
	return errors
}

// Validate checks that all required registration fields are present.
func (r *RegisterRequest) Validate() map[string]string {
	errors := map[string]string{}

	if r.Email == "" {
		errors["email"] = "Email is required"
	}
	if len(r.Password) < 6 {
		errors["password"] = "Password must be at least 6 characters"
	}
	if r.Name == "" {
		errors["name"] = "Name is required"
	}

	return errors
}

// LoginRequest contains the credentials for authentication.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Validate checks that login credentials are present.
func (r *LoginRequest) Validate() map[string]string {
	errors := map[string]string{}

	if r.Email == "" {
		errors["email"] = "Email is required"
	}
	if r.Password == "" {
		errors["password"] = "Password is required"
	}

	return errors
}

// AuthResponse is sent back after successful login/registration.
type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}
