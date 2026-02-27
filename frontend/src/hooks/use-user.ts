'use client';

import { useAuth } from '@/context/auth-context';

/**
 * useUser — convenience hook for accessing user data and role helpers.
 * Delegates entirely to AuthContext (single source of truth).
 */
export function useUser() {
    const { user, loading, isSuperAdmin, isAdmin, isCompanyOwner, isViewer, canWrite } = useAuth();
    return { user, loading, isSuperAdmin, isAdmin, isCompanyOwner, isViewer, canWrite };
}
