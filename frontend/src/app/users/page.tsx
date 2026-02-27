'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { api } from '@/lib/api';
import type { AdminUser, Company } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Shield, Eye, Building2, Crown, UserCheck } from 'lucide-react';
import { toast } from 'sonner';

const ROLE_CONFIG = {
    super_admin: { label: 'Super Admin', icon: Crown, color: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300' },
    admin: { label: 'Admin', icon: Shield, color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' },
    company_owner: { label: 'Company Owner', icon: Building2, color: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400' },
    viewer: { label: 'Viewer', icon: Eye, color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400' },
} as const;

type CompanyAssignment = { companyId: string; companyName: string };

export default function UsersPage() {
    const { user, isAdmin, isSuperAdmin, loading: authLoading } = useUser();
    const router = useRouter();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);

    const [companyDialogUser, setCompanyDialogUser] = useState<AdminUser | null>(null);
    const [userCompanies, setUserCompanies] = useState<CompanyAssignment[]>([]);
    const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
    const [savingCompanies, setSavingCompanies] = useState(false);

    const fetchUsers = useCallback(async () => {
        try {
            const res = await api.users.list();
            setUsers(res.data);
        } catch {
            toast.error('Failed to fetch users');
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchCompanies = useCallback(async () => {
        try {
            const res = await api.companies.list();
            setCompanies(res.data || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (!authLoading && !isAdmin) {
            router.push('/');
            return;
        }
        if (!authLoading && isAdmin) {
            fetchUsers();
            fetchCompanies();
        }
    }, [authLoading, isAdmin, router, fetchUsers, fetchCompanies]);

    const handleRoleChange = async (targetId: string, newRole: string) => {
        try {
            await api.users.updateRole(targetId, newRole);
            setUsers(prev => prev.map(u =>
                u.id === targetId ? { ...u, role: newRole } : u
            ));
            toast.success('Role updated successfully');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update role';
            toast.error(message);
        }
    };

    const handleDelete = async (targetId: string) => {
        try {
            await api.users.delete(targetId);
            setUsers(prev => prev.filter(u => u.id !== targetId));
            toast.success('User deleted successfully');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to delete user';
            toast.error(message);
        }
    };

    const openCompanyDialog = async (u: AdminUser) => {
        setCompanyDialogUser(u);
        try {
            const res = await api.users.getCompanies(u.id);
            setUserCompanies(res.data || []);
            setSelectedCompanyIds(new Set((res.data || []).map((c: CompanyAssignment) => c.companyId)));
        } catch {
            setUserCompanies([]);
            setSelectedCompanyIds(new Set());
        }
    };

    const toggleCompany = (companyId: string) => {
        setSelectedCompanyIds(prev => {
            const next = new Set(prev);
            if (next.has(companyId)) next.delete(companyId);
            else next.add(companyId);
            return next;
        });
    };

    const saveCompanies = async () => {
        if (!companyDialogUser) return;
        setSavingCompanies(true);
        try {
            await api.users.setCompanies(companyDialogUser.id, Array.from(selectedCompanyIds));
            toast.success('Company assignments updated');
            setCompanyDialogUser(null);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update assignments';
            toast.error(message);
        } finally {
            setSavingCompanies(false);
        }
    };

    const getRoleOptions = (targetRole: string) => {
        if (isSuperAdmin) {
            return ['super_admin', 'admin', 'company_owner', 'viewer'] as const;
        }
        if (targetRole === 'admin' || targetRole === 'super_admin') {
            return [] as const;
        }
        return ['company_owner', 'viewer'] as const;
    };

    const canModifyUser = (u: AdminUser) => {
        if (u.id === user?.id) return false;
        if (!isSuperAdmin && (u.role === 'admin' || u.role === 'super_admin')) return false;
        return true;
    };

    const needsCompanyAssignment = (role: string) =>
        role === 'company_owner' || role === 'viewer';

    if (authLoading || loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAdmin) return null;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">User Management</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Manage user accounts, roles, and company assignments.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Users ({users.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Email</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Role</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Companies</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Joined</th>
                                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => {
                                    const isSelf = u.id === user?.id;
                                    const modifiable = canModifyUser(u);
                                    const roleOptions = getRoleOptions(u.role);
                                    const cfg = ROLE_CONFIG[u.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.viewer;
                                    const Icon = cfg.icon;

                                    return (
                                        <tr key={u.id} className="border-b border-border/50 hover:bg-accent/30">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                                                        {u.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="font-medium text-foreground">
                                                        {u.name}
                                                        {isSelf && <span className="text-xs text-muted-foreground ml-2">(you)</span>}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">{u.email}</td>
                                            <td className="py-3 px-4">
                                                {!modifiable || roleOptions.length === 0 ? (
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                                                        <Icon className="h-3 w-3" /> {cfg.label}
                                                    </span>
                                                ) : (
                                                    <Select
                                                        value={u.role}
                                                        onValueChange={(val) => handleRoleChange(u.id, val)}
                                                    >
                                                        <SelectTrigger className="w-40 h-8 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {roleOptions.map(role => {
                                                                const rc = ROLE_CONFIG[role];
                                                                const RIcon = rc.icon;
                                                                return (
                                                                    <SelectItem key={role} value={role}>
                                                                        <span className="flex items-center gap-1.5">
                                                                            <RIcon className="h-3 w-3" /> {rc.label}
                                                                        </span>
                                                                    </SelectItem>
                                                                );
                                                            })}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                {needsCompanyAssignment(u.role) ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-xs gap-1.5"
                                                        onClick={() => openCompanyDialog(u)}
                                                    >
                                                        <Building2 className="h-3 w-3" />
                                                        Assign
                                                    </Button>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">All companies</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">
                                                {new Date(u.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                {modifiable && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete User</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Are you sure you want to delete <strong>{u.name}</strong> ({u.email})?
                                                                    This action cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={() => handleDelete(u.id)}
                                                                    className="bg-red-600 hover:bg-red-700"
                                                                >
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {users.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground">No users found</div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Company Assignment Dialog */}
            <Dialog open={!!companyDialogUser} onOpenChange={(open) => !open && setCompanyDialogUser(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Assign Companies — {companyDialogUser?.name}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Select which companies this user can access. Users without any assignment will see empty data.
                    </p>
                    <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                        {companies.length === 0 ? (
                            <div className="text-center py-6 text-sm text-muted-foreground">No companies available</div>
                        ) : (
                            companies.map(c => (
                                <label key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 cursor-pointer">
                                    <Checkbox
                                        checked={selectedCompanyIds.has(c.id)}
                                        onCheckedChange={() => toggleCompany(c.id)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm font-medium text-foreground">{c.name}</span>
                                        {c.employeeCount !== undefined && (
                                            <span className="text-xs text-muted-foreground ml-2">
                                                ({c.employeeCount} employees)
                                            </span>
                                        )}
                                    </div>
                                </label>
                            ))
                        )}
                    </div>
                    <div className="flex items-center justify-between pt-2">
                        <span className="text-xs text-muted-foreground">
                            {selectedCompanyIds.size} selected
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setCompanyDialogUser(null)}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={saveCompanies} disabled={savingCompanies}>
                                {savingCompanies ? 'Saving...' : 'Save'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
