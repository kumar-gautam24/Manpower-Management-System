'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { Users, LayoutDashboard, Building2, Sun, Moon, LogOut, Bell, DollarSign, ClipboardList, UserCog, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import type { Notification as AppNotification } from '@/types';

const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/employees', label: 'Employees', icon: Users },
    { href: '/companies', label: 'Companies', icon: Building2 },
    { href: '/salary', label: 'Salary', icon: DollarSign },
    { href: '/activity', label: 'Activity', icon: ClipboardList },
];

const adminNavItems = [
    { href: '/users', label: 'Users', icon: UserCog },
    { href: '/settings', label: 'Settings', icon: Settings },
];

// Pages that render without the navigation bar
const AUTH_PAGES = ['/login', '/register'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, loading, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();

    // Don't show nav on login/register pages
    if (AUTH_PAGES.includes(pathname)) {
        return <>{children}</>;
    }

    // Show nothing while checking auth status
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Not logged in — children will redirect via AuthContext
    if (!user) {
        return <>{children}</>;
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border/60 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
                    <div className="flex items-center justify-between h-14 sm:h-16">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-2.5 group">
                            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                                <Users className="h-4 w-4 text-white" />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className="font-bold text-sm text-foreground leading-tight">Manpower</h1>
                                <p className="text-[10px] text-muted-foreground leading-tight">Management System</p>
                            </div>
                        </Link>

                        {/* Navigation Links */}
                        <nav className="flex items-center gap-1">
                            {[...navItems, ...(user.role === 'admin' || user.role === 'super_admin' ? adminNavItems : [])].map((item) => {
                                const isActive =
                                    item.href === '/'
                                        ? pathname === '/'
                                        : pathname.startsWith(item.href);

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`
                      relative flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium
                      transition-all duration-200
                      ${isActive
                                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                                            }
                    `}
                                    >
                                        <item.icon className="h-4 w-4" />
                                        <span className="hidden sm:inline">{item.label}</span>
                                        {isActive && (
                                            <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full sm:left-4 sm:right-4" />
                                        )}
                                    </Link>
                                );
                            })}
                        </nav>

                        {/* Right side: notification bell, theme toggle, user menu */}
                        <div className="flex items-center gap-1 sm:gap-2">
                            {/* Notification Bell */}
                            <NotificationBell />

                            {/* Theme Toggle */}
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleTheme}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                            </Button>

                            {/* User Menu */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="gap-2 px-2 sm:px-3">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="hidden sm:inline text-sm font-medium text-foreground">
                                            {user.name}
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <div className="px-2 py-1.5">
                                        <p className="text-sm font-medium text-foreground">{user.name}</p>
                                        <p className="text-xs text-muted-foreground">{user.email}</p>
                                        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                                            {user.role.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={logout} className="text-red-600 dark:text-red-400 cursor-pointer">
                                        <LogOut className="h-4 w-4 mr-2" /> Sign Out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main>
                <div className="max-w-7xl mx-auto p-4 sm:p-6 md:p-8">{children}</div>
            </main>
        </div>
    );
}

// ── Notification Bell Component ───────────────────────────────
function NotificationBell() {
    const [count, setCount] = useState(0);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [open, setOpen] = useState(false);

    const fetchCount = useCallback(async () => {
        try {
            const res = await api.notifications.count();
            setCount(res.count);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 30000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    const handleOpen = async (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen) {
            try {
                const res = await api.notifications.list();
                setNotifications(res.data || []);
            } catch { /* ignore */ }
        }
    };

    const markAllRead = async () => {
        try {
            await api.notifications.markAllRead();
            setCount(0);
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch { /* ignore */ }
    };

    return (
        <DropdownMenu open={open} onOpenChange={handleOpen}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                    <Bell className="h-4 w-4" />
                    {count > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {count > 9 ? '9+' : count}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-auto">
                <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm font-semibold text-foreground">Notifications</span>
                    {count > 0 && (
                        <button onClick={markAllRead} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                            Mark all read
                        </button>
                    )}
                </div>
                <DropdownMenuSeparator />
                {notifications.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</div>
                ) : (
                    notifications.slice(0, 10).map((n) => (
                        <DropdownMenuItem key={n.id} className={`flex flex-col items-start gap-0.5 px-3 py-2 cursor-default ${!n.read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}>
                            <span className="text-sm font-medium text-foreground">{n.title}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{n.message}</span>
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
