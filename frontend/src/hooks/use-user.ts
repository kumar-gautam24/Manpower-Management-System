'use client';

import { useAuth } from '@/context/auth-context';

/**
 * useUser — convenience hook for accessing user data and role.
 * Delegates entirely to AuthContext (single source of truth).
 *
 * Before: independently decoded JWT from localStorage (caused role leaking).
 * After: reads fresh user data from AuthContext (set by /auth/me response).
 */
export function useUser() {
    const { user, loading, isAdmin } = useAuth();
    return { user, loading, isAdmin };
}
