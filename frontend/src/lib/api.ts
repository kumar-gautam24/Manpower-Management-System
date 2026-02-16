import type {
    Employee,
    EmployeeWithCompany,
    Document,
    DocumentWithCompliance,
    DashboardMetrics,
    ExpiryAlert,
    Company,
    CompanySummary,
    ComplianceStats,
    DependencyAlert,
    CreateEmployeeRequest,
    ExitEmployeeRequest,
    CreateDocumentRequest,
    CreateCompanyRequest,
    SalaryRecordWithEmployee,
    SalarySummary,
    SalaryRecord,
    Notification,
    ActivityLog,
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ── Custom Error ──────────────────────────────────────────────
class ApiClientError extends Error {
    constructor(
        message: string,
        public status: number,
        public data?: unknown
    ) {
        super(message);
        this.name = 'ApiClientError';
    }
}

// ── Auth Token ────────────────────────────────────────────────
function getAuthHeaders(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Core Fetcher ──────────────────────────────────────────────
async function fetcher<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders(),
                ...options?.headers,
            },
        });

        if (response.status === 401 && typeof window !== 'undefined') {
            localStorage.removeItem('token');
            window.location.href = '/login';
            throw new ApiClientError('Session expired', 401);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new ApiClientError(
                errorData?.message || errorData?.error || 'An error occurred',
                response.status,
                errorData
            );
        }

        return response.json();
    } catch (error) {
        if (error instanceof ApiClientError) {
            throw error;
        }
        throw new ApiClientError('Network error. Is the backend running?', 0, error);
    }
}

// ── Download Helper (for CSV export) ──────────────────────────
async function downloadFile(endpoint: string, filename: string) {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) throw new ApiClientError('Download failed', response.status);
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── File Upload Fetcher (multipart) ───────────────────────────
async function uploadFile(
    file: File,
    category: string = 'documents'
): Promise<{ url: string; fileName: string; fileSize: number; fileType: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Upload failed' }));
        throw new ApiClientError(err.message || 'Upload failed', response.status);
    }

    return response.json();
}

// ── Pagination Types ──────────────────────────────────────────
export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: PaginationMeta;
}

// ── API Client ────────────────────────────────────────────────
export const api = {
    health: () => fetcher<{ status: string }>('/api/health'),

    // ── Dashboard ─────────────────────────────────────────────
    dashboard: {
        getMetrics: () => fetcher<DashboardMetrics>('/api/dashboard/metrics'),
        getExpiryAlerts: () =>
            fetcher<{ data: ExpiryAlert[]; total: number }>('/api/dashboard/expiring'),
        getCompanySummary: () =>
            fetcher<{ data: CompanySummary[] }>('/api/dashboard/company-summary'),
        getComplianceStats: () =>
            fetcher<ComplianceStats>('/api/dashboard/compliance'),
    },

    // ── Companies ─────────────────────────────────────────────
    companies: {
        list: () => fetcher<{ data: Company[] }>('/api/companies'),
        create: (data: CreateCompanyRequest) =>
            fetcher<{ data: Company; message: string }>('/api/companies', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
        update: (id: string, data: CreateCompanyRequest) =>
            fetcher<{ data: Company; message: string }>(`/api/companies/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            }),
        delete: (id: string) =>
            fetcher<{ message: string }>(`/api/companies/${id}`, {
                method: 'DELETE',
            }),
    },

    // ── Employees ─────────────────────────────────────────────
    employees: {
        list: (params?: Record<string, string | number | undefined>) => {
            const queryParams = new URLSearchParams();
            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    if (value !== undefined && value !== '') {
                        queryParams.append(key, String(value));
                    }
                });
            }
            const qs = queryParams.toString();
            return fetcher<PaginatedResponse<EmployeeWithCompany>>(
                `/api/employees${qs ? `?${qs}` : ''}`
            );
        },
        get: (id: string) =>
            fetcher<{ data: EmployeeWithCompany }>(
                `/api/employees/${id}`
            ),
        create: (data: CreateEmployeeRequest) =>
            fetcher<{ data: Employee; message: string }>('/api/employees', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
        update: (id: string, data: Partial<CreateEmployeeRequest>) =>
            fetcher<{ data: Employee; message: string }>(`/api/employees/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            }),
        delete: (id: string) =>
            fetcher<{ message: string }>(`/api/employees/${id}`, {
                method: 'DELETE',
            }),
        exit: (id: string, data: ExitEmployeeRequest) =>
            fetcher<{ data: Employee; message: string }>(`/api/employees/${id}/exit`, {
                method: 'PATCH',
                body: JSON.stringify(data),
            }),
        batchDelete: (ids: string[]) =>
            fetcher<{ message: string; deleted: number }>('/api/employees/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ ids }),
            }),
        getDependencyAlerts: (id: string) =>
            fetcher<{ data: DependencyAlert[] }>(`/api/employees/${id}/dependency-alerts`),
        export: () => downloadFile('/api/employees/export', 'employees.csv'),
    },

    // ── Documents ─────────────────────────────────────────────
    documents: {
        listByEmployee: (employeeId: string) =>
            fetcher<{ data: DocumentWithCompliance[]; completion: { total: number; complete: number } }>(
                `/api/employees/${employeeId}/documents`
            ),
        get: (id: string) =>
            fetcher<{ data: { document: DocumentWithCompliance; employeeName: string; companyName: string } }>(
                `/api/documents/${id}`
            ),
        create: (employeeId: string, data: CreateDocumentRequest) =>
            fetcher<{ data: DocumentWithCompliance; message: string }>(
                `/api/employees/${employeeId}/documents`,
                { method: 'POST', body: JSON.stringify(data) }
            ),
        update: (id: string, data: Partial<CreateDocumentRequest>) =>
            fetcher<{ data: DocumentWithCompliance; message: string }>(`/api/documents/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            }),
        delete: (id: string) =>
            fetcher<{ message: string }>(`/api/documents/${id}`, {
                method: 'DELETE',
            }),
        batchDelete: (ids: string[]) =>
            fetcher<{ message: string; deleted: number }>('/api/documents/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ ids }),
            }),
        togglePrimary: (id: string) =>
            fetcher<{ message: string }>(`/api/documents/${id}/primary`, {
                method: 'PATCH',
            }),
        renew: (id: string, data: {
            documentNumber?: string;
            issueDate?: string;
            expiryDate: string;
            metadata?: Record<string, unknown>;
            fileUrl?: string;
            fileName?: string;
            fileSize?: number;
            fileType?: string;
        }) =>
            fetcher<{ data: DocumentWithCompliance; message: string }>(`/api/documents/${id}/renew`, {
                method: 'POST',
                body: JSON.stringify(data),
            }),
    },

    // ── Salary ────────────────────────────────────────────────
    salary: {
        generate: (month: number, year: number) =>
            fetcher<{ message: string; inserted: number }>('/api/salary/generate', {
                method: 'POST',
                body: JSON.stringify({ month, year }),
            }),
        list: (params?: { month?: number; year?: number; status?: string; company_id?: string }) => {
            const qp = new URLSearchParams();
            if (params) {
                Object.entries(params).forEach(([k, v]) => {
                    if (v !== undefined && v !== '') qp.append(k, String(v));
                });
            }
            const qs = qp.toString();
            return fetcher<{ data: SalaryRecordWithEmployee[] }>(
                `/api/salary${qs ? `?${qs}` : ''}`
            );
        },
        summary: (month: number, year: number) =>
            fetcher<{ data: SalarySummary }>(`/api/salary/summary?month=${month}&year=${year}`),
        updateStatus: (id: string, status: string) =>
            fetcher<{ data: SalaryRecord; message: string }>(`/api/salary/${id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status }),
            }),
        bulkUpdateStatus: (ids: string[], status: string) =>
            fetcher<{ message: string; updated: number }>('/api/salary/bulk-status', {
                method: 'PATCH',
                body: JSON.stringify({ ids, status }),
            }),
        export: (month: number, year: number) =>
            downloadFile(`/api/salary/export?month=${month}&year=${year}`, `salary_${year}_${String(month).padStart(2, '0')}.csv`),
    },

    // ── Notifications ─────────────────────────────────────────
    notifications: {
        list: () => fetcher<{ data: Notification[] }>('/api/notifications'),
        count: () => fetcher<{ count: number }>('/api/notifications/count'),
        markRead: (id: string) =>
            fetcher<{ message: string }>(`/api/notifications/${id}/read`, {
                method: 'PATCH',
            }),
        markAllRead: () =>
            fetcher<{ message: string }>('/api/notifications/read-all', {
                method: 'PATCH',
            }),
    },

    // ── Activity Log ──────────────────────────────────────────
    activity: {
        list: (limit: number = 20) =>
            fetcher<{ data: ActivityLog[]; total: number }>(`/api/activity?limit=${limit}`),
    },

    // ── File Upload ───────────────────────────────────────────
    upload: uploadFile,
};

export { ApiClientError };
