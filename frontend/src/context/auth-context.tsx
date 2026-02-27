'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    companyIds?: string[];
}

interface AuthContextValue {
    user: User | null;
    token: string | null;
    loading: boolean;
    isSuperAdmin: boolean;
    isAdmin: boolean;
    isCompanyOwner: boolean;
    isViewer: boolean;
    canWrite: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (name: string, email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Pages that don't require authentication
const PUBLIC_PATHS = ['/login', '/register'];

/**
 * AuthProvider manages authentication state across the entire app.
 * - Single source of truth for user, token, and role
 * - Cross-tab sync via storage event listener
 * - Redirects unauthenticated users to /login automatically
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();
    // Guard against redirect loops and double-validation
    const isValidating = useRef(false);

    // Validate a token against /auth/me and update state
    const validateToken = useCallback(async (storedToken: string) => {
        if (isValidating.current) return;
        isValidating.current = true;

        try {
            const res = await fetch(`${API_BASE}/api/auth/me`, {
                headers: { Authorization: `Bearer ${storedToken}` },
            });

            if (!res.ok) {
                // Token expired or invalid — clear everything
                localStorage.removeItem('token');
                setToken(null);
                setUser(null);
                return;
            }

            const userData: User = await res.json();
            setUser(userData);
            setToken(storedToken);
        } catch {
            localStorage.removeItem('token');
            setToken(null);
            setUser(null);
        } finally {
            isValidating.current = false;
            setLoading(false);
        }
    }, []);

    // Validate stored token on initial load
    useEffect(() => {
        const storedToken = localStorage.getItem('token');
        if (!storedToken) {
            setLoading(false);
            return;
        }
        validateToken(storedToken);
    }, [validateToken]);

    // Cross-tab sync: detect login/logout in other tabs
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key !== 'token') return;

            if (!e.newValue) {
                // Another tab logged out
                setToken(null);
                setUser(null);
                router.replace('/login');
            } else if (e.newValue !== token) {
                // Another tab logged in (possibly as different user)
                validateToken(e.newValue);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [token, router, validateToken]);

    // Redirect unauthenticated users to login
    useEffect(() => {
        if (loading) return;
        if (!user && !PUBLIC_PATHS.includes(pathname)) {
            router.replace('/login');
        }
    }, [user, loading, pathname, router]);

    const login = useCallback(async (email: string, password: string) => {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: 'Login failed' }));
            throw new Error(err.message || 'Invalid credentials');
        }

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        router.push('/');
    }, [router]);

    const register = useCallback(async (name: string, email: string, password: string) => {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: 'Registration failed' }));
            throw new Error(err.message || 'Could not create account');
        }

        const data = await res.json();
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        router.push('/');
    }, [router]);

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
        router.push('/login');
    }, [router]);

    const isSuperAdmin = user?.role === 'super_admin';
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
    const isCompanyOwner = user?.role === 'company_owner';
    const isViewer = user?.role === 'viewer';
    const canWrite = isAdmin || isCompanyOwner;

    return (
        <AuthContext.Provider value={{ user, token, loading, isSuperAdmin, isAdmin, isCompanyOwner, isViewer, canWrite, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
}
