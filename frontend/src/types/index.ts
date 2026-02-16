// ── Core Entities ─────────────────────────────────────────────

export interface Company {
    id: string;
    name: string;
    currency: string;
    tradeLicenseNumber?: string | null;
    establishmentCardNumber?: string | null;
    mohreCategory?: string | null;        // "1" | "2" | "3"
    regulatoryAuthority?: string | null;  // "MOHRE" | "JAFZA" | "DMCC" | etc.
    employeeCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface CompanySummary {
    id: string;
    name: string;
    currency: string;
    employeeCount: number;
}

export interface Employee {
    id: string;
    companyId: string;
    name: string;
    trade: string;
    mobile: string;
    joiningDate: string;
    photoUrl?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    nationality?: string | null;
    passportNumber?: string | null;
    nativeLocation?: string | null;
    currentLocation?: string | null;
    salary?: number | null;
    status: string; // active, inactive, on_leave, terminated, resigned
    exitType?: string | null;   // resigned, terminated, absconded
    exitDate?: string | null;
    exitNotes?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface EmployeeWithCompany extends Employee {
    companyName: string;
    companyCurrency: string;
    complianceStatus: 'expired' | 'expiring' | 'valid' | 'incomplete' | 'none';
    nearestExpiryDays?: number | null;
    docsComplete: number;
    docsTotal: number;
    urgentDocType?: string | null;
    expiredCount: number;
    expiringCount: number;
}

// ── Documents ─────────────────────────────────────────────────

export interface Document {
    id: string;
    employeeId: string;
    documentType: string;
    documentNumber?: string | null;
    issueDate?: string | null;
    expiryDate?: string | null;
    gracePeriodDays: number;
    finePerDay: number;
    fineType: string;       // "daily" | "monthly" | "one_time"
    fineCap: number;
    isPrimary: boolean;
    isMandatory: boolean;
    metadata: Record<string, unknown>;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    lastUpdated: string;
    createdAt: string;
}

/** Document with computed compliance fields (returned from API) */
export interface DocumentWithCompliance extends Document {
    status: DocComplianceStatus;
    displayName: string;
    estimatedFine: number;
    daysRemaining?: number | null;
    graceDaysRemaining?: number | null;
    daysInPenalty?: number | null;
}

export type DocComplianceStatus =
    | 'incomplete'
    | 'valid'
    | 'expiring_soon'
    | 'in_grace'
    | 'penalty_active';

// ── Salary ────────────────────────────────────────────────────

export interface SalaryRecord {
    id: string;
    employeeId: string;
    month: number;
    year: number;
    amount: number;
    status: 'pending' | 'paid' | 'partial';
    paidDate?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SalaryRecordWithEmployee extends SalaryRecord {
    employeeName: string;
    companyName: string;
    currency: string;
}

export interface SalarySummary {
    totalAmount: number;
    paidAmount: number;
    pendingCount: number;
    paidCount: number;
    partialCount: number;
    totalCount: number;
    currency: string;
}

// ── Notifications ─────────────────────────────────────────────

export interface Notification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    entityType?: string | null;
    entityId?: string | null;
    createdAt: string;
}

// ── Activity ──────────────────────────────────────────────────

export interface ActivityLog {
    id: string;
    userId: string;
    userName: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    createdAt: string;
}

// ── Dashboard ─────────────────────────────────────────────────

export interface DashboardMetrics {
    totalEmployees: number;
    activeDocuments: number;
    expiringSoon: number;
    expired: number;
}

export interface ExpiryAlert {
    documentId: string;
    employeeId: string;
    employeeName: string;
    companyName: string;
    documentType: string;
    expiryDate: string;
    daysLeft: number;
    status: 'expired' | 'urgent' | 'warning';
    estimatedFine: number;
    finePerDay: number;
}

// ── Compliance Stats ──────────────────────────────────────────

export interface ComplianceStats {
    totalEmployees: number;
    totalDocuments: number;
    documentsByStatus: Record<DocComplianceStatus, number>;
    completionRate: number;
    totalDailyFine: number;
    totalAccumulated: number;
    companyBreakdown: CompanyCompliance[];
    criticalAlerts: ExpiryAlert[];
}

export interface CompanyCompliance {
    companyId: string;
    companyName: string;
    employeeCount: number;
    penaltyCount: number;
    incompleteCount: number;
    dailyExposure: number;
    accumulatedFines: number;
}

export interface DependencyAlert {
    severity: 'critical' | 'warning';
    blockingDoc: string;
    blockedDoc: string;
    message: string;
    blockingExpiry: string;
    blockedExpiry: string;
}

// ── API Requests ──────────────────────────────────────────────

export interface CreateEmployeeRequest {
    companyId: string;
    name: string;
    trade: string;
    mobile?: string;        // now optional
    joiningDate: string;
    photoUrl?: string;
    gender?: string;
    dateOfBirth?: string;
    nationality?: string;
    passportNumber?: string;
    nativeLocation?: string;
    currentLocation?: string;
    salary?: number;
    status?: string;
}

export interface ExitEmployeeRequest {
    exitType: 'resigned' | 'terminated' | 'absconded';
    exitDate: string;
    exitNotes?: string;
}

export interface CreateDocumentRequest {
    documentType: string;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    gracePeriodDays?: number;
    finePerDay?: number;
    fineType?: string;
    fineCap?: number;
    metadata?: Record<string, unknown>;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
}

export interface CreateCompanyRequest {
    name: string;
    currency?: string;
    tradeLicenseNumber?: string;
    establishmentCardNumber?: string;
    mohreCategory?: string;
    regulatoryAuthority?: string;
}

// ── API Responses ─────────────────────────────────────────────

export interface ApiResponse<T> {
    data: T;
    message?: string;
}

export interface ApiError {
    error: string;
    message: string;
    status: number;
}

export interface EmployeeFilters {
    company_id?: string;
    trade?: string;
    status?: string;         // document status: valid, expiring, expired, incomplete, penalty_active
    emp_status?: string;     // employee status: active, inactive, on_leave, terminated, resigned
    nationality?: string;
    search?: string;
    sort_by?: string;
    sort_order?: string;
    page?: number;
    limit?: number;
}
