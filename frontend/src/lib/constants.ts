/**
 * Display name map — used as a fallback when DB document types are unavailable.
 * The canonical source of truth is now the document_types table.
 */

const DOC_DISPLAY_NAMES: Record<string, string> = {
    passport: 'Passport',
    visa: 'Residence Visa',
    emirates_id: 'Emirates ID',
    work_permit: 'Work Permit / Labour Card',
    health_insurance: 'Health Insurance',
    iloe_insurance: 'ILOE Insurance',
    medical_fitness: 'Medical Fitness Certificate',
    trade_license: 'Trade License',
    other: 'Other',
};

/** Get display name for a document type. Falls back to title-cased input. */
export function docDisplayName(type?: string | null, metadata?: Record<string, unknown> | null): string {
    if (!type) return 'Document';
    if (type === 'other' && metadata?.custom_name) return String(metadata.custom_name);
    return DOC_DISPLAY_NAMES[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Status Colors ────────────────────────────────────────────

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
