'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    Users, Plus, Search, Loader2, Phone, Building2, Calendar,
    AlertTriangle, XCircle, CheckCircle, FileText, ArrowUpDown, Download, Trash2,
} from 'lucide-react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { docDisplayName, getStatusConfig } from '@/lib/constants';
import type { EmployeeWithCompany, Company } from '@/types';
import { useUser } from '@/hooks/use-user';
import { toast } from 'sonner';

const DOC_STATUS_OPTIONS = [
    { value: 'all', label: 'All Docs' },
    { value: 'valid', label: 'Valid' },
    { value: 'expiring', label: 'Expiring' },
    { value: 'in_grace', label: 'In Grace' },
    { value: 'penalty_active', label: 'Penalty Active' },
    { value: 'expired', label: 'Expired' },
    { value: 'incomplete', label: 'Incomplete' },
];

const EMP_STATUS_OPTIONS = [
    { value: 'all', label: 'All Status' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'on_leave', label: 'On Leave' },
];

const SORT_OPTIONS = [
    { value: 'name', label: 'Name' },
    { value: 'joining_date', label: 'Joining Date' },
    { value: 'salary', label: 'Salary' },
    { value: 'created_at', label: 'Date Added' },
];

/** Build a human-readable compliance summary for the card */
function getComplianceInfo(emp: EmployeeWithCompany) {
    const days = emp.nearestExpiryDays ?? 0;
    const absDays = Math.abs(days);
    const urgentName = docDisplayName(emp.urgentDocType);

    if (emp.complianceStatus === 'penalty_active' || emp.complianceStatus === 'expired') {
        const s = getStatusConfig('penalty_active');
        const others = emp.expiredCount - 1;
        const who = others > 0 ? `${urgentName} +${others} other${others > 1 ? 's' : ''}` : urgentName;
        const when = absDays === 0 ? 'today' : absDays === 1 ? '1 day ago' : `${absDays} days ago — fines active`;
        return { text: `${who} — penalty active`, sub: when, color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
    }
    if (emp.complianceStatus === 'in_grace') {
        const s = getStatusConfig('in_grace');
        const who = urgentName;
        const when = absDays === 0 ? 'expired today' : `expired ${absDays} day${absDays > 1 ? 's' : ''} ago — in grace period`;
        return { text: `${who} in grace period`, sub: when, color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
    }
    if (emp.complianceStatus === 'expiring_soon' || emp.complianceStatus === 'expiring') {
        const s = getStatusConfig('expiring_soon');
        const others = emp.expiringCount - 1;
        const who = others > 0 ? `${urgentName} +${others} other${others > 1 ? 's' : ''}` : urgentName;
        const when = days === 0 ? 'today' : days === 1 ? '1 day left' : `${days} days left`;
        return { text: `${who} expiring soon`, sub: when, color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
    }
    if (emp.complianceStatus === 'valid') {
        const s = getStatusConfig('valid');
        return { text: 'All documents valid', sub: days > 0 ? `Next renewal in ${days} days` : '', color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
    }
    if (emp.complianceStatus === 'incomplete') {
        const s = getStatusConfig('incomplete');
        const missing = emp.docsTotal - emp.docsComplete;
        return { text: `${missing} document${missing > 1 ? 's' : ''} incomplete`, sub: 'Missing data', color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
    }
    const s = getStatusConfig('none');
    return { text: 'No documents', sub: '', color: s.text, dotColor: s.dot, badgeColor: s.badge, badgeLabel: s.label };
}

export default function EmployeesPage() {
    const searchParams = useSearchParams();
    const [employees, setEmployees] = useState<EmployeeWithCompany[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const { canWrite } = useUser();

    // Pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 20;

    // Filters — initialize from URL params (dashboard drilldown links)
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [companyFilter, setCompanyFilter] = useState(searchParams.get('company_id') || 'all');
    const [docStatusFilter, setDocStatusFilter] = useState(searchParams.get('status') || 'all');
    const [empStatusFilter, setEmpStatusFilter] = useState(searchParams.get('emp_status') || 'all');
    const [tradeFilter, setTradeFilter] = useState(searchParams.get('trade') || '');

    // Debounce search — 300ms delay
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = (value: string) => {
        setSearch(value);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            setDebouncedSearch(value);
            setPage(1);
        }, 300);
    };

    // Sorting
    const [sortBy, setSortBy] = useState('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Multi-select
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selected.size === employees.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(employees.map(e => e.id)));
        }
    };

    const handleBatchDelete = async () => {
        if (selected.size === 0) return;
        try {
            setDeleting(true);
            const res = await api.employees.batchDelete(Array.from(selected));
            toast.success(res.message);
            setSelected(new Set());
            fetchEmployees();
        } catch {
            toast.error('Failed to delete employees');
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const fetchCompanies = useCallback(async () => {
        try {
            const res = await api.companies.list();
            setCompanies(res.data || []);
        } catch { /* silent — companies used only for filter */ }
    }, []);

    const fetchEmployees = useCallback(async () => {
        try {
            setLoading(true);
            const params: Record<string, string | number | undefined> = {
                page,
                limit,
                sort_by: sortBy,
                sort_order: sortOrder,
            };
            if (debouncedSearch) params.search = debouncedSearch;
            if (companyFilter !== 'all') params.company_id = companyFilter;
            if (docStatusFilter !== 'all') params.status = docStatusFilter;
            if (empStatusFilter !== 'all') params.emp_status = empStatusFilter;
            if (tradeFilter) params.trade = tradeFilter;

            const res = await api.employees.list(params);
            setEmployees(res.data || []);
            setTotalPages(res.pagination?.totalPages ?? 1);
            setTotal(res.pagination?.total ?? 0);
        } catch {
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    }, [page, limit, debouncedSearch, companyFilter, docStatusFilter, empStatusFilter, tradeFilter, sortBy, sortOrder]);

    useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    /** Reset page to 1 when any filter/sort changes */
    const updateFilter = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
        setter(value);
        setPage(1);
    };

    /** Toggle sort direction or switch sort field */
    const handleSortChange = (newSortBy: string) => {
        if (newSortBy === sortBy) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(newSortBy);
            setSortOrder('asc');
        }
        setPage(1);
    };

    /** Export employees CSV */
    const handleExport = async () => {
        try {
            setExporting(true);
            await api.employees.export();
            toast.success('Employee data exported');
        } catch {
            toast.error('Failed to export');
        } finally {
            setExporting(false);
        }
    };

    /** Collect unique trades from loaded employees for filter */
    const uniqueTrades = Array.from(new Set(employees.map(e => e.trade).filter(Boolean))).sort();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Employees</h1>
                    <p className="text-muted-foreground mt-1">{total} employee{total !== 1 ? 's' : ''} found</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                        {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                        Export CSV
                    </Button>
                    {canWrite && (
                        <Link href="/employees/new">
                            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add Employee</Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Selection toolbar */}
            {canWrite && selected.size > 0 && (
                <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-2.5">
                    <button
                        onClick={toggleSelectAll}
                        className="h-4 w-4 rounded border-2 border-blue-500 flex items-center justify-center flex-shrink-0 cursor-pointer"
                    >
                        {selected.size === employees.length && (
                            <CheckCircle className="h-3 w-3 text-blue-600" />
                        )}
                    </button>
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        {selected.size} selected
                    </span>
                    <div className="flex-1" />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(new Set())}
                        className="text-xs"
                    >
                        Clear
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deleting}
                        className="gap-1"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Selected
                    </Button>
                </div>
            )}

            {/* Filters + Sort bar */}
            <div className="space-y-3">
                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name..."
                        value={search}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="pl-9"
                    />
                </div>

                {/* Filter row */}
                <div className="flex flex-wrap gap-2">
                    {/* Company */}
                    <Select value={companyFilter} onValueChange={(v) => updateFilter(setCompanyFilter, v)}>
                        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Company" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Companies</SelectItem>
                            {companies.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                        </SelectContent>
                    </Select>

                    {/* Doc Status */}
                    <Select value={docStatusFilter} onValueChange={(v) => updateFilter(setDocStatusFilter, v)}>
                        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {DOC_STATUS_OPTIONS.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                        </SelectContent>
                    </Select>

                    {/* Employee Status */}
                    <Select value={empStatusFilter} onValueChange={(v) => updateFilter(setEmpStatusFilter, v)}>
                        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {EMP_STATUS_OPTIONS.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                        </SelectContent>
                    </Select>

                    {/* Trade Filter */}
                    <Select value={tradeFilter || 'all'} onValueChange={(v) => updateFilter(setTradeFilter, v === 'all' ? '' : v)}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Trade" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Trades</SelectItem>
                            {uniqueTrades.map(t => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                        </SelectContent>
                    </Select>

                    {/* Sort */}
                    <Select value={sortBy} onValueChange={(v) => handleSortChange(v)}>
                        <SelectTrigger className="w-[150px]">
                            <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SORT_OPTIONS.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                        </SelectContent>
                    </Select>

                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}>
                        <span className="text-xs font-medium">{sortOrder === 'asc' ? 'A↑' : 'Z↓'}</span>
                    </Button>
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Employee Cards */}
            {!loading && employees.length === 0 && (
                <div className="text-center py-16 space-y-3">
                    <Users className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                    <h2 className="text-lg font-semibold">No employees found</h2>
                    <p className="text-muted-foreground">Try adjusting your filters or add a new employee.</p>
                </div>
            )}

            {!loading && employees.length > 0 && (
                <div className="grid gap-3">
                    {employees.map((emp) => {
                        const info = getComplianceInfo(emp);

                        return (
                            <Link key={emp.id} href={`/employees/${emp.id}`}>
                                <Card className={`hover:shadow-md transition-shadow cursor-pointer ${selected.has(emp.id) ? 'border-blue-400 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-950/20' : 'border-border/60'}`}>
                                    <CardContent className="py-4 px-5">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-4 flex-1 min-w-0">
                                                {/* Checkbox (admin only) */}
                                                {canWrite && (
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(emp.id); }}
                                                        className={`h-4.5 w-4.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer
                                                            ${selected.has(emp.id)
                                                                ? 'bg-blue-600 border-blue-600'
                                                                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'}
                                                        `}
                                                    >
                                                        {selected.has(emp.id) && (
                                                            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                        )}
                                                    </button>
                                                )}

                                                {/* Avatar */}
                                                <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                                                    {emp.photoUrl ? (
                                                        <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950 dark:to-indigo-950 flex items-center justify-center">
                                                            <span className="text-blue-700 dark:text-blue-300 font-bold text-sm">
                                                                {emp.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Name + meta */}
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="font-semibold text-foreground truncate">{emp.name}</h3>
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-0.5">
                                                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {emp.companyName}</span>
                                                        <span>{emp.trade}</span>
                                                        {emp.mobile && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {emp.mobile}</span>}
                                                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {emp.joiningDate}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right side: contextual compliance info */}
                                            <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                                                {/* Employee status (if not active) */}
                                                {emp.status && emp.status !== 'active' && (
                                                    <Badge variant="outline" className={`text-[11px] ${emp.status === 'on_leave' ? 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400' : 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400'}`}>
                                                        {emp.status === 'on_leave' ? 'On Leave' : 'Inactive'}
                                                    </Badge>
                                                )}

                                                {/* Compliance message */}
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${info.dotColor}`} />
                                                    <span className={`text-xs font-medium ${info.color} max-w-[160px] truncate`}>
                                                        {info.text}
                                                    </span>
                                                </div>
                                                {info.sub && (
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {info.sub}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {!loading && totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-muted-foreground">
                        Page {page} of {totalPages} ({total} total)
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                            Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                            Next
                        </Button>
                    </div>
                </div>
            )}
            {/* Batch delete confirmation */}
            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selected.size} employee{selected.size > 1 ? 's' : ''}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the selected employee{selected.size > 1 ? 's' : ''} and all associated documents. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={handleBatchDelete} disabled={deleting}>
                            {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
