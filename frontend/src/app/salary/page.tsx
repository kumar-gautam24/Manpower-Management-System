'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { SalaryRecordWithEmployee, SalarySummary, Company } from '@/types';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useUser } from '@/hooks/use-user';
import { DollarSign, Download, RefreshCw, CheckCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SalaryPage() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [records, setRecords] = useState<SalaryRecordWithEmployee[]>([]);
    const [summary, setSummary] = useState<SalarySummary | null>(null);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [companyFilter, setCompanyFilter] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    const [generating, setGenerating] = useState(false);
    const { isAdmin } = useUser();

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, summaryRes] = await Promise.all([
                api.salary.list({ month, year, status: statusFilter !== 'all' ? statusFilter : undefined, company_id: companyFilter || undefined }),
                api.salary.summary(month, year),
            ]);
            setRecords(listRes.data || []);
            setSummary(summaryRes.data);
        } catch {
            toast.error('Failed to load salary data');
        } finally {
            setLoading(false);
        }
    }, [month, year, statusFilter, companyFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        api.companies.list().then(res => setCompanies(res.data || [])).catch(() => { });
    }, []);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await api.salary.generate(month, year);
            toast.success(`${res.inserted} salary records generated`);
            fetchData();
        } catch (e) {
            console.error(e);
            toast.error('Failed to generate salary records');
        } finally {
            setGenerating(false);
        }
    };

    const handleToggleStatus = async (id: string, currentStatus: string) => {
        const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
        try {
            await api.salary.updateStatus(id, newStatus);
            fetchData();
        } catch {
            toast.error('Failed to update salary status');
        }
    };

    const handleBulkPaid = async () => {
        if (selected.size === 0) return;
        try {
            await api.salary.bulkUpdateStatus(Array.from(selected), 'paid');
            toast.success(`${selected.size} records marked as paid`);
            setSelected(new Set());
            fetchData();
        } catch {
            toast.error('Failed to update salary records');
        }
    };

    const handleExport = async () => {
        try {
            await api.salary.export(month, year);
            toast.success('Salary data exported');
        } catch {
            toast.error('Failed to export salary data');
        }
    };

    const prevMonth = () => {
        if (month === 1) { setMonth(12); setYear(y => y - 1); }
        else setMonth(m => m - 1);
    };

    const nextMonth = () => {
        if (month === 12) { setMonth(1); setYear(y => y + 1); }
        else setMonth(m => m + 1);
    };

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selected.size === records.length) setSelected(new Set());
        else setSelected(new Set(records.map(r => r.id)));
    };

    const statusBadge = (status: string) => {
        if (status === 'paid') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"><CheckCircle className="h-3 w-3" /> Paid</span>;
        if (status === 'partial') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"><AlertTriangle className="h-3 w-3" /> Partial</span>;
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"><Clock className="h-3 w-3" /> Pending</span>;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Salary Tracker</h1>
                    <p className="text-sm text-muted-foreground mt-1">Manage monthly salary payments</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport}>
                        <Download className="h-4 w-4 mr-1" /> Export CSV
                    </Button>
                    {isAdmin && (
                        <Button onClick={handleGenerate} disabled={generating} size="sm">
                            <RefreshCw className={`h-4 w-4 mr-1 ${generating ? 'animate-spin' : ''}`} />
                            Generate
                        </Button>
                    )}
                </div>
            </div>

            {/* Month Selector */}
            <div className="flex items-center justify-center gap-4">
                <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="h-5 w-5" /></Button>
                <span className="text-lg font-semibold text-foreground min-w-[180px] text-center">
                    {MONTHS[month - 1]} {year}
                </span>
                <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="h-5 w-5" /></Button>
            </div>

            {/* Summary Cards */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <SummaryCard title="Total" value={`${summary.currency} ${summary.totalAmount.toLocaleString()}`} sub={`${summary.totalCount} records`} color="blue" />
                    <SummaryCard title="Paid" value={`${summary.currency} ${summary.paidAmount.toLocaleString()}`} sub={`${summary.paidCount} employees`} color="emerald" />
                    <SummaryCard title="Pending" value={`${summary.pendingCount}`} sub="awaiting payment" color="slate" />
                    <SummaryCard title="Partial" value={`${summary.partialCount}`} sub="incomplete" color="amber" />
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={companyFilter || 'all'} onValueChange={(v) => setCompanyFilter(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="Company" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Companies</SelectItem>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                {isAdmin && selected.size > 0 && (
                    <Button onClick={handleBulkPaid} size="sm" variant="outline" className="text-green-600 border-green-300 dark:border-green-700">
                        <CheckCircle className="h-4 w-4 mr-1" /> Mark {selected.size} as Paid
                    </Button>
                )}
            </div>

            {/* Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : records.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <DollarSign className="h-10 w-10 text-muted-foreground/40" />
                        <p className="text-muted-foreground text-sm">No salary records for {MONTHS[month - 1]} {year}</p>
                        <p className="text-xs text-muted-foreground">Click &quot;Generate&quot; to create salary records for all active employees</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/30">

                                    {isAdmin && (
                                        <th className="px-4 py-3 text-left">
                                            <Checkbox
                                                checked={selected.size === records.length && records.length > 0}
                                                onCheckedChange={toggleSelectAll}
                                            />
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Amount</th>
                                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Paid Date</th>
                                    {isAdmin && <th className="px-4 py-3 text-center font-medium text-muted-foreground">Action</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {records.map(rec => (
                                    <tr key={rec.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                                        {isAdmin && (
                                            <td className="px-4 py-3">
                                                <Checkbox
                                                    checked={selected.has(rec.id)}
                                                    onCheckedChange={() => toggleSelect(rec.id)}
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-3 font-medium text-foreground">{rec.employeeName}</td>
                                        <td className="px-4 py-3 text-muted-foreground">{rec.companyName}</td>
                                        <td className="px-4 py-3 text-right font-mono text-foreground">
                                            <span className="text-xs text-muted-foreground mr-1">{rec.currency}</span>
                                            {rec.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-center">{statusBadge(rec.status)}</td>
                                        <td className="px-4 py-3 text-center text-muted-foreground text-xs">{rec.paidDate || '—'}</td>
                                        {isAdmin && (
                                            <td className="px-4 py-3 text-center">
                                                <Button variant="ghost" size="sm"
                                                    onClick={() => handleToggleStatus(rec.id, rec.status)}
                                                    className={rec.status === 'paid'
                                                        ? 'text-yellow-600 hover:text-yellow-700'
                                                        : 'text-green-600 hover:text-green-700'
                                                    }>
                                                    {rec.status === 'paid' ? 'Undo' : 'Mark Paid'}
                                                </Button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({ title, value, sub }: { title: string; value: string; sub: string; color?: string }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-xl font-bold text-foreground mt-1">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
    );
}
