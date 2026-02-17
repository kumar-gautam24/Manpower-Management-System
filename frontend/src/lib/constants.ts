/** Canonical document types — single source of truth across the app */

export const DOC_TYPES = {
    passport: 'Passport',
    visa: 'Residence Visa',
    emirates_id: 'Emirates ID',
    work_permit: 'Work Permit / Labour Card',
    health_insurance: 'Health Insurance',
    iloe_insurance: 'ILOE Insurance',
    medical_fitness: 'Medical Fitness Certificate',
    trade_license: 'Trade License',
    other: 'Other',
} as const;

export type DocTypeKey = keyof typeof DOC_TYPES;

/** The 7 mandatory per-employee document types */
export const MANDATORY_DOC_TYPES: DocTypeKey[] = [
    'passport', 'visa', 'emirates_id', 'work_permit',
    'health_insurance', 'iloe_insurance', 'medical_fitness',
];

/** Get display name for a document type. Falls back to title-cased input. */
export function docDisplayName(type?: string | null, metadata?: Record<string, unknown> | null): string {
    if (!type) return 'Document';
    if (type === 'other' && metadata?.custom_name) return String(metadata.custom_name);
    return DOC_TYPES[type as DocTypeKey] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Per-type field configuration ──────────────────────────────

export interface MetadataFieldDef {
    key: string;
    label: string;
    type: 'text' | 'select' | 'number' | 'date';
    placeholder?: string;
    options?: { value: string; label: string }[];
    required?: boolean;
}

export interface DocTypeConfig {
    numberLabel: string;
    numberPlaceholder: string;
    hasExpiry: boolean;
    expiryLabel: string;
    defaultGraceDays: number;
    defaultFinePerDay: number;
    defaultFineType: 'daily' | 'monthly' | 'one_time';
    defaultFineCap: number;
    metadataFields: MetadataFieldDef[];
}

/** Per-type configuration driving dynamic form rendering and UAE compliance defaults */
export const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = {
    passport: {
        numberLabel: 'Passport Number',
        numberPlaceholder: 'e.g. A12345678',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 0,
        defaultFinePerDay: 0,
        defaultFineType: 'daily',
        defaultFineCap: 0,
        metadataFields: [
            { key: 'nationality', label: 'Nationality', type: 'text', placeholder: 'e.g. Indian' },
            { key: 'issuing_country', label: 'Issuing Country', type: 'text', placeholder: 'e.g. India' },
        ],
    },
    visa: {
        numberLabel: 'Visa Number',
        numberPlaceholder: 'e.g. 201/2024/1234567',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 30,
        defaultFinePerDay: 50,
        defaultFineType: 'daily',
        defaultFineCap: 0,
        metadataFields: [
            {
                key: 'visa_type', label: 'Visa Type', type: 'select',
                options: [
                    { value: 'employment', label: 'Employment' },
                    { value: 'residence', label: 'Residence' },
                    { value: 'mission', label: 'Mission' },
                    { value: 'green', label: 'Green Visa' },
                    { value: 'golden', label: 'Golden Visa' },
                ],
            },
            { key: 'sponsor', label: 'Sponsor / Company', type: 'text', placeholder: 'Sponsoring company' },
            { key: 'linked_passport', label: 'Linked Passport Number', type: 'text', placeholder: 'Passport number' },
        ],
    },
    emirates_id: {
        numberLabel: 'Emirates ID Number',
        numberPlaceholder: 'e.g. 784-1990-1234567-1',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 30,
        defaultFinePerDay: 20,
        defaultFineType: 'daily',
        defaultFineCap: 1000,
        metadataFields: [
            { key: 'linked_visa', label: 'Linked Visa Number', type: 'text', placeholder: 'Visa number' },
        ],
    },
    work_permit: {
        numberLabel: 'Permit / Labour Card Number',
        numberPlaceholder: 'e.g. 1234567',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 50,
        defaultFinePerDay: 500,
        defaultFineType: 'one_time',
        defaultFineCap: 500,
        metadataFields: [
            { key: 'mohre_file_number', label: 'MoHRE File Number', type: 'text', placeholder: 'e.g. 12345' },
            { key: 'job_title', label: 'Job Title (on permit)', type: 'text', placeholder: 'e.g. Electrician' },
        ],
    },
    health_insurance: {
        numberLabel: 'Policy Number',
        numberPlaceholder: 'e.g. POL-2024-12345',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 30,
        defaultFinePerDay: 500,
        defaultFineType: 'monthly',
        defaultFineCap: 150000,
        metadataFields: [
            { key: 'insurer_name', label: 'Insurance Provider', type: 'text', placeholder: 'e.g. Daman, Oman Insurance' },
            { key: 'coverage_amount', label: 'Coverage Amount (AED)', type: 'number', placeholder: 'e.g. 250000' },
        ],
    },
    iloe_insurance: {
        numberLabel: 'Subscription ID',
        numberPlaceholder: 'e.g. ILOE-2024-12345',
        hasExpiry: true,
        expiryLabel: 'Renewal Date',
        defaultGraceDays: 0,
        defaultFinePerDay: 400,
        defaultFineType: 'one_time',
        defaultFineCap: 400,
        metadataFields: [
            {
                key: 'category', label: 'Category', type: 'select',
                options: [
                    { value: 'A', label: 'Category A (≤ AED 16,000 salary)' },
                    { value: 'B', label: 'Category B (> AED 16,000 salary)' },
                ],
            },
            {
                key: 'subscription_status', label: 'Subscription Status', type: 'select',
                options: [
                    { value: 'active', label: 'Active' },
                    { value: 'lapsed', label: 'Lapsed' },
                ],
            },
        ],
    },
    medical_fitness: {
        numberLabel: 'Certificate Number',
        numberPlaceholder: 'e.g. MED-2024-12345',
        hasExpiry: true,
        expiryLabel: 'Valid Until',
        defaultGraceDays: 0,
        defaultFinePerDay: 0,
        defaultFineType: 'daily',
        defaultFineCap: 0,
        metadataFields: [
            { key: 'test_date', label: 'Test Date', type: 'date' },
            {
                key: 'result', label: 'Result', type: 'select',
                options: [
                    { value: 'fit', label: 'Fit' },
                    { value: 'unfit', label: 'Unfit' },
                ],
            },
        ],
    },
    trade_license: {
        numberLabel: 'License Number',
        numberPlaceholder: 'e.g. TL-12345',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 0,
        defaultFinePerDay: 0,
        defaultFineType: 'daily',
        defaultFineCap: 0,
        metadataFields: [],
    },
    other: {
        numberLabel: 'Document Number',
        numberPlaceholder: 'e.g. DOC-12345',
        hasExpiry: true,
        expiryLabel: 'Expiry Date',
        defaultGraceDays: 0,
        defaultFinePerDay: 0,
        defaultFineType: 'daily',
        defaultFineCap: 0,
        metadataFields: [
            { key: 'custom_name', label: 'Document Name', type: 'text', placeholder: 'e.g. Certificate of Good Conduct', required: true },
        ],
    },
};

/** Get config for a document type, falling back to 'other' */
export function getDocTypeConfig(type?: string | null): DocTypeConfig {
    if (!type) return DOC_TYPE_CONFIG.other;
    return DOC_TYPE_CONFIG[type] || DOC_TYPE_CONFIG.other;
}

/** Reverse map: display name → snake_case key */
export const DOC_DISPLAY_TO_KEY: Record<string, string> = Object.fromEntries(
    Object.entries(DOC_TYPES).map(([key, display]) => [display, key])
);

/**
 * Status color system — consistent colors across all pages.
 * Each status maps to a badge className string and a dot color.
 */
export const STATUS_COLORS = {
    expired: {
        badge: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
        label: 'Expired',
    },
    penalty_active: {
        badge: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
        label: 'Penalty Active',
    },
    urgent: {
        badge: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
        dot: 'bg-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
        label: 'Urgent',
    },
    in_grace: {
        badge: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
        dot: 'bg-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
        label: 'In Grace',
    },
    expiring: {
        badge: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
        dot: 'bg-yellow-500',
        text: 'text-yellow-600 dark:text-yellow-500',
        label: 'Expiring Soon',
    },
    expiring_soon: {
        badge: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
        dot: 'bg-yellow-500',
        text: 'text-yellow-600 dark:text-yellow-500',
        label: 'Expiring Soon',
    },
    valid: {
        badge: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
        dot: 'bg-green-500',
        text: 'text-green-600 dark:text-green-400',
        label: 'Valid',
    },
    incomplete: {
        badge: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
        dot: 'bg-yellow-500',
        text: 'text-yellow-600 dark:text-yellow-500',
        label: 'Incomplete',
    },
    none: {
        badge: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
        dot: 'bg-gray-400',
        text: 'text-muted-foreground',
        label: 'No Docs',
    },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

/** Get status config, falling back to 'none' for unknown statuses */
export function getStatusConfig(status?: string | null) {
    if (!status) return STATUS_COLORS.none;
    return STATUS_COLORS[status as StatusKey] || STATUS_COLORS.none;
}

/** Employee status badge colors */
export const EMP_STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
    on_leave: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400',
    inactive: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400',
};
