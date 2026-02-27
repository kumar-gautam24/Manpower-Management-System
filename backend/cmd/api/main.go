package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"

	"manpower-backend/internal/config"
	"manpower-backend/internal/cron"
	"manpower-backend/internal/database"
	"manpower-backend/internal/handlers"
	"manpower-backend/internal/middleware"
	"manpower-backend/internal/storage"
)

func main() {
	// 1. Load configuration from environment
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 2. Connect to PostgreSQL
	db := database.New(&cfg.DB)
	defer db.Close()

	// 3. Initialize file storage (R2 in production, local filesystem for dev)
	var fileStore storage.Store
	if os.Getenv("STORAGE") == "r2" {
		fileStore, err = storage.NewR2Store(
			os.Getenv("R2_ACCOUNT_ID"),
			os.Getenv("R2_ACCESS_KEY"),
			os.Getenv("R2_SECRET_KEY"),
			os.Getenv("R2_BUCKET"),
			os.Getenv("R2_PUBLIC_URL"),
		)
		if err != nil {
			log.Fatalf("Failed to initialize R2 storage: %v", err)
		}
		log.Println("Using Cloudflare R2 storage")
	} else {
		fileStore, err = storage.NewLocalStore(cfg.Upload.Dir, cfg.Upload.BaseURL)
		if err != nil {
			log.Fatalf("Failed to initialize local storage: %v", err)
		}
		log.Println("Using local file storage")
	}

	// 4. Set up router with global middleware
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	// Build CORS allowed origins: includes localhost for dev + production URL from env
	corsOrigins := []string{"http://localhost:3000", "http://localhost:3001"}
	if frontendURL := os.Getenv("FRONTEND_URL"); frontendURL != "" {
		corsOrigins = append(corsOrigins, frontendURL)
	}

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// 5. Initialize handlers with their dependencies
	authHandler := handlers.NewAuthHandler(db, cfg.JWTSecret)
	dashboardHandler := handlers.NewDashboardHandler(db)
	employeeHandler := handlers.NewEmployeeHandler(db)
	documentHandler := handlers.NewDocumentHandler(db)
	companyHandler := handlers.NewCompanyHandler(db)
	uploadHandler := handlers.NewUploadHandler(fileStore)
	salaryHandler := handlers.NewSalaryHandler(db)
	activityHandler := handlers.NewActivityHandler(db)
	notificationHandler := handlers.NewNotificationHandler(db)
	adminHandler := handlers.NewAdminHandler(db)
	userMgmtHandler := handlers.NewUserManagementHandler(db)

	// Start background cron jobs
	cron.StartNotifier(db)

	// 6. Public routes (no authentication required)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Manpower Management System API"))
	})
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(db.Health())
	})

	// Auth routes — public (login and register don't need a token)
	// Rate-limited to prevent brute-force and registration spam
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(rate.Every(12*time.Second), 5)) // ~5 req/min per IP
		r.Post("/api/auth/login", authHandler.Login)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(rate.Every(20*time.Second), 3)) // ~3 req/min per IP
		r.Post("/api/auth/register", authHandler.Register)
	})

	// Serve uploaded files (local storage serves from disk; R2 redirects to CDN)
	r.Get("/api/files/*", uploadHandler.ServeFile)

	// 7. Protected routes (require valid JWT + inject company scope)
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))
		r.Use(middleware.InjectCompanyScope(db.GetPool()))

		// ── Read endpoints (all roles, company-scoped via handlers) ────
		r.Get("/api/auth/me", authHandler.GetMe)
		r.Post("/api/upload", uploadHandler.Upload)

		// Dashboard
		r.Get("/api/dashboard/metrics", dashboardHandler.GetMetrics)
		r.Get("/api/dashboard/expiring", dashboardHandler.GetExpiryAlerts)
		r.Get("/api/dashboard/company-summary", dashboardHandler.GetCompanySummary)
		r.Get("/api/dashboard/compliance", dashboardHandler.GetComplianceStats)

		// Notifications (user-scoped)
		r.Get("/api/notifications", notificationHandler.List)
		r.Get("/api/notifications/count", notificationHandler.UnreadCount)
		r.Patch("/api/notifications/read-all", notificationHandler.MarkAllRead)
		r.Patch("/api/notifications/{id}/read", notificationHandler.MarkRead)

		// Activity log
		r.Get("/api/activity", activityHandler.List)

		// Companies (read)
		r.Get("/api/companies", companyHandler.List)
		r.Get("/api/companies/{id}", companyHandler.GetByID)

		// Employees (read)
		r.Get("/api/employees", employeeHandler.List)
		r.Get("/api/employees/export", employeeHandler.Export)
		r.Route("/api/employees/{id}", func(r chi.Router) {
			r.Get("/", employeeHandler.GetByID)
			r.Get("/documents", documentHandler.ListByEmployee)
			r.Get("/dependency-alerts", dashboardHandler.GetDependencyAlerts)
			r.Get("/salary", salaryHandler.ListByEmployee)
		})

		// Salary & documents (read)
		r.Get("/api/salary", salaryHandler.List)
		r.Get("/api/salary/summary", salaryHandler.Summary)
		r.Get("/api/salary/export", salaryHandler.Export)
		r.Get("/api/documents/{id}", documentHandler.GetByID)

		// Document types (read — needed for forms)
		r.Get("/api/document-types", adminHandler.ListDocumentTypes)

		// ── Writer endpoints (company_owner + admin + super_admin) ──────
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireMinRole("company_owner"))

			// Employee write (scoped via handler checks)
			r.Post("/api/employees", employeeHandler.Create)
			r.Put("/api/employees/{id}", employeeHandler.Update)
			r.Delete("/api/employees/{id}", employeeHandler.Delete)
			r.Post("/api/employees/batch-delete", employeeHandler.BatchDelete)
			r.Patch("/api/employees/{id}/exit", employeeHandler.Exit)

			// Document write
			r.Post("/api/employees/{employeeId}/documents", documentHandler.Create)
			r.Post("/api/documents/batch-delete", documentHandler.BatchDelete)
			r.Route("/api/documents/{id}", func(r chi.Router) {
				r.Put("/", documentHandler.Update)
				r.Delete("/", documentHandler.Delete)
				r.Patch("/primary", documentHandler.TogglePrimary)
				r.Post("/renew", documentHandler.Renew)
			})

			// Salary write
			r.Post("/api/salary/generate", salaryHandler.Generate)
			r.Patch("/api/salary/bulk-status", salaryHandler.BulkUpdateStatus)
			r.Patch("/api/salary/{id}/status", salaryHandler.UpdateStatus)
		})

		// ── Admin endpoints (admin + super_admin) ──────────────────────
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireMinRole("admin"))

			// Company write (admin-only)
			r.Post("/api/companies", companyHandler.Create)
			r.Put("/api/companies/{id}", companyHandler.Update)
			r.Delete("/api/companies/{id}", companyHandler.Delete)

			// User management
			r.Get("/api/users", userMgmtHandler.List)
			r.Put("/api/users/{id}/role", userMgmtHandler.UpdateRole)
			r.Delete("/api/users/{id}", userMgmtHandler.Delete)
			r.Get("/api/users/{id}/companies", userMgmtHandler.GetUserCompanies)
			r.Put("/api/users/{id}/companies", userMgmtHandler.SetUserCompanies)

			// Admin settings: document types
			r.Post("/api/admin/document-types", adminHandler.CreateDocumentType)
			r.Put("/api/admin/document-types/{id}", adminHandler.UpdateDocumentType)
			r.Delete("/api/admin/document-types/{id}", adminHandler.DeleteDocumentType)

			// Admin settings: compliance rules
			r.Get("/api/admin/compliance-rules", adminHandler.ListComplianceRules)
			r.Put("/api/admin/compliance-rules", adminHandler.UpsertComplianceRules)

			// Admin settings: document dependencies
			r.Get("/api/admin/dependencies", adminHandler.ListDependencies)
			r.Post("/api/admin/dependencies", adminHandler.CreateDependency)
			r.Put("/api/admin/dependencies/{id}", adminHandler.UpdateDependency)
			r.Delete("/api/admin/dependencies/{id}", adminHandler.DeleteDependency)
		})
	})

	// 8. Start server with graceful shutdown
	server := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.Port),
		Handler: r,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("Server started on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	<-done
	log.Println("Server stopped")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited properly")
}
