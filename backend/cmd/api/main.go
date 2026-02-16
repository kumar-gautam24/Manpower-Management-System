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

	// 3. Initialize file storage (local filesystem — swap to S3 by changing this line)
	fileStore, err := storage.NewLocalStore(cfg.Upload.Dir, cfg.Upload.BaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize file storage: %v", err)
	}

	// 4. Set up router with global middleware
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:3001"},
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
	r.Post("/api/auth/register", authHandler.Register)
	r.Post("/api/auth/login", authHandler.Login)

	// Serve uploaded files (local storage only — replace with S3 URLs in production)
	r.Get("/api/files/*", uploadHandler.ServeFile)

	// 7. Protected routes (require valid JWT)
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))

		// Current user profile
		r.Get("/api/auth/me", authHandler.GetMe)

		// File upload
		r.Post("/api/upload", uploadHandler.Upload)

		// Dashboard (read-only — accessible to all authenticated users)
		r.Get("/api/dashboard/metrics", dashboardHandler.GetMetrics)
		r.Get("/api/dashboard/expiring", dashboardHandler.GetExpiryAlerts)
		r.Get("/api/dashboard/company-summary", dashboardHandler.GetCompanySummary)
		r.Get("/api/dashboard/compliance", dashboardHandler.GetComplianceStats)

		// Notifications (user-scoped, all authenticated users)
		r.Get("/api/notifications", notificationHandler.List)
		r.Get("/api/notifications/count", notificationHandler.UnreadCount)
		r.Patch("/api/notifications/read-all", notificationHandler.MarkAllRead)
		r.Patch("/api/notifications/{id}/read", notificationHandler.MarkRead)

		// Activity log (read-only)
		r.Get("/api/activity", activityHandler.List)

		// Companies — list is read-only for all roles
		r.Get("/api/companies", companyHandler.List)

		// Read-only employee & document endpoints — accessible to viewers
		r.Get("/api/employees", employeeHandler.List)
		r.Get("/api/employees/export", employeeHandler.Export)
		r.Route("/api/employees/{id}", func(r chi.Router) {
			r.Get("/", employeeHandler.GetByID)
			r.Get("/documents", documentHandler.ListByEmployee)
			r.Get("/dependency-alerts", dashboardHandler.GetDependencyAlerts)
			r.Get("/salary", salaryHandler.ListByEmployee)
		})

		// Read-only salary & document endpoints — accessible to viewers
		r.Get("/api/salary", salaryHandler.List)
		r.Get("/api/salary/summary", salaryHandler.Summary)
		r.Get("/api/salary/export", salaryHandler.Export)
		r.Get("/api/documents/{id}", documentHandler.GetByID)

		// Write operations restricted to admin role
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireMinRole("admin"))

			// Company write operations
			r.Post("/api/companies", companyHandler.Create)
			r.Put("/api/companies/{id}", companyHandler.Update)
			r.Delete("/api/companies/{id}", companyHandler.Delete)

			// Employee write operations
			r.Post("/api/employees", employeeHandler.Create)
			r.Put("/api/employees/{id}", employeeHandler.Update)
			r.Delete("/api/employees/{id}", employeeHandler.Delete)
			r.Post("/api/employees/batch-delete", employeeHandler.BatchDelete)
			r.Patch("/api/employees/{id}/exit", employeeHandler.Exit)

			// Document write operations (nested under employee for create)
			r.Post("/api/employees/{employeeId}/documents", documentHandler.Create)
			r.Post("/api/documents/batch-delete", documentHandler.BatchDelete)
			r.Route("/api/documents/{id}", func(r chi.Router) {
				r.Put("/", documentHandler.Update)
				r.Delete("/", documentHandler.Delete)
				r.Patch("/primary", documentHandler.TogglePrimary)
				r.Post("/renew", documentHandler.Renew)
			})

			// Salary write operations
			r.Post("/api/salary/generate", salaryHandler.Generate)
			r.Patch("/api/salary/bulk-status", salaryHandler.BulkUpdateStatus)
			r.Patch("/api/salary/{id}/status", salaryHandler.UpdateStatus)
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
