'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    ArrowLeft, Pencil, Trash2, Phone, Building2, Calendar,
    Briefcase, FileText, Plus, Loader2, Star, RefreshCw,
    DollarSign, MapPin, Globe, User, MoreHorizontal, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getStatusConfig, docDisplayName, EMP_STATUS_COLORS } from '@/lib/constants';
import type { EmployeeWithCompany, DocumentWithCompliance, DependencyAlert } from '@/types';
import { toast } from 'sonner';
import { AddDocumentDialog, EditDocumentDialog } from '@/components/documents/add-document-dialog';
import { RenewDocumentDialog } from '@/components/documents/renew-document-dialog';
import { DocumentTimeline } from '@/components/documents/document-timeline';
import { useUser } from '@/hooks/use-user';

/** Check if a doc slot is incomplete (no data filled in yet) */
function isIncomplete(doc: DocumentWithCompliance): boolean {
    return doc.status === 'incomplete';
}

/** Sort: penalty/grace first, then expiring, valid, incomplete last */
function sortDocs(docs: DocumentWithCompliance[]): DocumentWithCompliance[] {
    const priority: Record<string, number> = {
        penalty_active: 0,
        in_grace: 1,
        expiring_soon: 2,
        valid: 3,
        incomplete: 4,
    };
    return [...docs].sort((a, b) => {
        const aPri = priority[a.status] ?? 99;
        const bPri = priority[b.status] ?? 99;
        if (aPri !== bPri) return aPri - bPri;
        // Within same status, sort by nearest expiry
        return (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999);
    });
}

/** Format a date string to "10 Feb 2026" */
function fmtDate(d?: string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EmployeeDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const [employee, setEmployee] = useState<EmployeeWithCompany | null>(null);
    const [documents, setDocuments] = useState<DocumentWithCompliance[]>([]);
    const [dependencyAlerts, setDependencyAlerts] = useState<DependencyAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const { isAdmin } = useUser();
    const [showAddDoc, setShowAddDoc] = useState(false);
    const [editingDoc, setEditingDoc] = useState<DocumentWithCompliance | null>(null);
    const [renewingDoc, setRenewingDoc] = useState<DocumentWithCompliance | null>(null);

    // Batch delete documents
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
    const [showBatchDeleteDocs, setShowBatchDeleteDocs] = useState(false);
    const [batchDeletingDocs, setBatchDeletingDocs] = useState(false);

    const toggleDocSelect = (docId: string) => {
        setSelectedDocs(prev => {
            const next = new Set(prev);
            if (next.has(docId)) next.delete(docId); else next.add(docId);
            return next;
        });
    };

    const toggleDocSelectAll = () => {
        if (selectedDocs.size === documents.length) {
            setSelectedDocs(new Set());
        } else {
            setSelectedDocs(new Set(documents.map(d => d.id)));
        }
    };

    const handleBatchDeleteDocs = async () => {
        if (selectedDocs.size === 0) return;
        try {
            setBatchDeletingDocs(true);
            const res = await api.documents.batchDelete(Array.from(selectedDocs));
            toast.success(res.message);
            setSelectedDocs(new Set());
            fetchEmployee();
        } catch {
            toast.error('Failed to delete documents');
        } finally {
            setBatchDeletingDocs(false);
            setShowBatchDeleteDocs(false);
        }
    };

    const fetchEmployee = useCallback(async () => {
        try {
            setLoading(true);
            const [empRes, docRes] = await Promise.all([
                api.employees.get(id),
                api.documents.listByEmployee(id),
            ]);
            setEmployee(empRes.data);
            setDocuments(docRes.data || []);

            // Fetch dependency alerts (non-blocking)
            api.employees.getDependencyAlerts(id)
                .then(res => setDependencyAlerts(res.data || []))
                .catch(() => { /* non-critical */ });
        } catch {
            toast.error('Failed to load employee details');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetchEmployee(); }, [fetchEmployee]);

    const handleDelete = async () => {
        try {
            setDeleting(true);
            await api.employees.delete(id);
            toast.success('Employee deleted successfully');
            router.push('/employees');
        } catch {
            toast.error('Failed to delete employee');
        } finally {
            setDeleting(false);
        }
    };

    const handleDeleteDocument = async (docId: string) => {
        try {
            await api.documents.delete(docId);
            toast.success('Document deleted');
            fetchEmployee();
        } catch {
            toast.error('Failed to delete document');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!employee) {
        return (
            <div className="max-w-2xl mx-auto text-center py-20">
                <h2 className="text-xl font-semibold text-muted-foreground">Employee not found</h2>
                <Link href="/employees">
                    <Button className="mt-4">Back to Employees</Button>
                </Link>
            </div>
        );
    }

    // Compute fine summary
    const totalFine = documents.reduce((sum, d) => sum + (d.estimatedFine || 0), 0);
    const inGraceCount = documents.filter(d => d.status === 'in_grace').length;
    const penaltyCount = documents.filter(d => d.status === 'penalty_active').length;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Back button */}
            <Link href="/employees" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to employees
            </Link>

            {/* Employee Info Card */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-col sm:flex-row gap-6">
                        {/* Avatar */}
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950 dark:to-indigo-950 flex items-center justify-center flex-shrink-0">
                            <span className="text-blue-700 dark:text-blue-300 font-bold text-2xl">
                                {employee.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                            </span>
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl font-bold text-foreground">{employee.name}</h1>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" /> {employee.trade}</span>
                                        <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> {employee.companyName}</span>
                                        <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" /> {employee.mobile}</span>
                                        <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Joined {employee.joiningDate}</span>
                                    </div>
                                </div>

                                {isAdmin && (
                                    <div className="flex gap-2 flex-shrink-0">
                                        <Link href={`/employees/${id}/edit`}>
                                            <Button variant="outline" size="sm"><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                                        </Link>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" size="sm" className="text-red-600 dark:text-red-400 hover:text-red-700">
                                                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete {employee.name}?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This will permanently delete this employee and all their documents.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
                                                        {deleting ? 'Deleting...' : 'Delete'}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Profile Details Card */}
            {(employee.gender || employee.dateOfBirth || employee.nationality || employee.passportNumber || employee.nativeLocation || employee.currentLocation || employee.salary || employee.status) && (
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-sm font-medium text-muted-foreground mb-4">Profile Details</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {employee.gender && (
                                <div className="flex items-center gap-2 text-sm">
                                    <User className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Gender:</span>
                                    <span className="font-medium capitalize">{employee.gender}</span>
                                </div>
                            )}
                            {employee.dateOfBirth && (
                                <div className="flex items-center gap-2 text-sm">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">DOB:</span>
                                    <span className="font-medium">{employee.dateOfBirth}</span>
                                </div>
                            )}
                            {employee.nationality && (
                                <div className="flex items-center gap-2 text-sm">
                                    <Globe className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Nationality:</span>
                                    <span className="font-medium">{employee.nationality}</span>
                                </div>
                            )}
                            {employee.passportNumber && (
                                <div className="flex items-center gap-2 text-sm">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Passport:</span>
                                    <span className="font-medium">{employee.passportNumber}</span>
                                </div>
                            )}
                            {employee.nativeLocation && (
                                <div className="flex items-center gap-2 text-sm">
                                    <MapPin className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Native:</span>
                                    <span className="font-medium">{employee.nativeLocation}</span>
                                </div>
                            )}
                            {employee.currentLocation && (
                                <div className="flex items-center gap-2 text-sm">
                                    <MapPin className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Current:</span>
                                    <span className="font-medium">{employee.currentLocation}</span>
                                </div>
                            )}
                            {employee.salary != null && (
                                <div className="flex items-center gap-2 text-sm">
                                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-muted-foreground">Salary:</span>
                                    <span className="font-medium">{employee.companyCurrency || 'AED'} {employee.salary.toLocaleString()}/mo</span>
                                </div>
                            )}
                            {employee.status && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">Status:</span>
                                    <Badge variant="outline" className={EMP_STATUS_COLORS[employee.status] || ''}>
                                        {employee.status === 'on_leave' ? 'On Leave' : employee.status.charAt(0).toUpperCase() + employee.status.slice(1)}
                                    </Badge>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Dependency Alerts */}
            {dependencyAlerts.length > 0 && (
                <div className="space-y-2">
                    {dependencyAlerts.map((alert, i) => (
                        <div
                            key={i}
                            className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm ${
                                alert.severity === 'critical'
                                    ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 text-red-800 dark:text-red-300'
                                    : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-300'
                            }`}
                        >
                            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span>{alert.message}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Documents Section */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Documents</CardTitle>
                            <CardDescription>{documents.length} document{documents.length !== 1 ? 's' : ''}</CardDescription>
                        </div>
                        {isAdmin && (
                            <Button size="sm" onClick={() => setShowAddDoc(true)}>
                                <Plus className="h-4 w-4 mr-1" /> Add Document
                            </Button>
                        )}
                    </div>

                    {/* Document selection toolbar */}
                    {isAdmin && selectedDocs.size > 0 && (
                        <div className="mt-3 flex items-center gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-2">
                            <Checkbox
                                checked={selectedDocs.size === documents.length}
                                onCheckedChange={toggleDocSelectAll}
                            />
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                {selectedDocs.size} selected
                            </span>
                            <div className="flex-1" />
                            <Button variant="ghost" size="sm" onClick={() => setSelectedDocs(new Set())} className="text-xs h-7">
                                Clear
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setShowBatchDeleteDocs(true)}
                                disabled={batchDeletingDocs}
                                className="gap-1 h-7"
                            >
                                <Trash2 className="h-3 w-3" /> Delete
                            </Button>
                        </div>
                    )}

                    {/* Progress bar for mandatory doc completion */}
                    {(() => {
                        const mandatory = documents.filter(d => d.isMandatory);
                        const complete = mandatory.filter(d => !isIncomplete(d)).length;
                        const total = mandatory.length;
                        if (total === 0) return null;
                        const pct = Math.round((complete / total) * 100);
                        return (
                            <div className="mt-3 space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        {complete}/{total} mandatory documents complete
                                    </span>
                                    <span className={`font-medium ${pct === 100 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        {pct}%
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })()}

                    {/* Fine exposure summary */}
                    {(totalFine > 0 || inGraceCount > 0) && (
                        <div className="mt-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="h-4 w-4 text-red-500" />
                                    <span className="text-sm font-medium text-foreground">Fine Exposure</span>
                                </div>
                                {totalFine > 0 && (
                                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                                        AED {totalFine.toLocaleString('en', { maximumFractionDigits: 0 })}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-3 mt-1">
                                {penaltyCount > 0 && (
                                    <p className="text-xs text-red-600 dark:text-red-400">{penaltyCount} document{penaltyCount !== 1 ? 's' : ''} with active fines</p>
                                )}
                                {inGraceCount > 0 && (
                                    <p className="text-xs text-orange-600 dark:text-orange-400">{inGraceCount} document{inGraceCount !== 1 ? 's' : ''} in grace period</p>
                                )}
                            </div>
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    {documents.length === 0 ? (
                        <div className="text-center py-8">
                            <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                            <p className="text-muted-foreground">No documents yet. Add one to start tracking.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {sortDocs(documents).map((doc) => {
                                const pending = isIncomplete(doc);
                                const statusCfg = getStatusConfig(doc.status);
                                const docName = doc.displayName || docDisplayName(doc.documentType, doc.metadata);
                                const hasExpiry = !!doc.expiryDate;
                                const isPrimary = doc.isPrimary;
                                const needsRenew = doc.status === 'expiring_soon' || doc.status === 'in_grace' || doc.status === 'penalty_active';

                                return (
                                    <div
                                        key={doc.id}
                                        className={`flex items-center justify-between py-3 gap-3 ${pending ? 'opacity-60' : ''}`}
                                    >
                                        {/* Left: checkbox + doc info */}
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            {isAdmin && (
                                                <Checkbox
                                                    checked={selectedDocs.has(doc.id)}
                                                    onCheckedChange={() => toggleDocSelect(doc.id)}
                                                />
                                            )}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="font-medium text-foreground text-sm">{docName}</h4>
                                                    {isPrimary && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
                                                    {doc.fileUrl && (
                                                        <a
                                                            href={doc.fileUrl.startsWith('http') ? doc.fileUrl : `${doc.fileUrl}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                                                            title="View file"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {pending ? (
                                                        'Not yet submitted'
                                                    ) : (
                                                        <>
                                                            {doc.documentNumber && <span>{doc.documentNumber} · </span>}
                                                            {doc.issueDate && <span>Issued {fmtDate(doc.issueDate)} · </span>}
                                                            {hasExpiry ? `Expires ${fmtDate(doc.expiryDate)}` : 'No expiry date'}
                                                        </>
                                                    )}
                                                </p>
                                                {/* Grace period info */}
                                                {doc.status === 'in_grace' && doc.graceDaysRemaining != null && (
                                                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                                        Grace: {doc.graceDaysRemaining} day{doc.graceDaysRemaining !== 1 ? 's' : ''} remaining
                                                    </p>
                                                )}
                                                {/* Fine info */}
                                                {doc.status === 'penalty_active' && doc.estimatedFine > 0 && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-0.5">
                                                        Fine: AED {doc.estimatedFine.toLocaleString('en', { maximumFractionDigits: 0 })}
                                                        {doc.daysInPenalty != null && ` (${doc.daysInPenalty} day${doc.daysInPenalty !== 1 ? 's' : ''} in penalty)`}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: status + actions */}
                                        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                                            {/* Days countdown */}
                                            {!pending && hasExpiry && doc.daysRemaining != null && (
                                                <div className="text-right hidden sm:block min-w-[48px]">
                                                    <div className={`text-base font-bold ${statusCfg.text}`}>
                                                        {Math.abs(doc.daysRemaining)}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground leading-tight">
                                                        {doc.daysRemaining < 0 ? 'overdue' : 'days left'}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Status badge */}
                                            <Badge variant="outline" className={`text-xs whitespace-nowrap ${pending
                                                ? 'bg-muted text-muted-foreground border-border'
                                                : statusCfg.badge
                                            }`}>
                                                {pending ? 'Pending' : statusCfg.label}
                                            </Badge>

                                            {/* Admin actions */}
                                            {isAdmin && (
                                                <div className="flex items-center gap-1">
                                                    {/* Inline Renew button for docs needing attention */}
                                                    {needsRenew && (
                                                        <Button
                                                            variant="outline" size="sm"
                                                            className="h-7 text-xs gap-1"
                                                            onClick={() => setRenewingDoc(doc)}
                                                        >
                                                            <RefreshCw className="h-3 w-3" /> Renew
                                                        </Button>
                                                    )}

                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                        onClick={() => setEditingDoc(doc)}
                                                        title="Edit"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>

                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {hasExpiry && (
                                                                <DropdownMenuItem onClick={async () => {
                                                                    try {
                                                                        await api.documents.togglePrimary(doc.id);
                                                                        toast.success(isPrimary ? 'Unset as tracked' : 'Set as tracked document');
                                                                        fetchEmployee();
                                                                    } catch {
                                                                        toast.error('Failed to toggle');
                                                                    }
                                                                }}>
                                                                    <Star className="h-3.5 w-3.5 mr-2" />
                                                                    {isPrimary ? 'Unset as tracked' : 'Set as tracked'}
                                                                </DropdownMenuItem>
                                                            )}
                                                            {hasExpiry && !needsRenew && (
                                                                <DropdownMenuItem onClick={() => setRenewingDoc(doc)}>
                                                                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                                                    Renew
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuItem
                                                                className="text-red-600 dark:text-red-400"
                                                                onClick={() => {
                                                                    if (confirm(`Delete ${docName}? This cannot be undone.`)) {
                                                                        handleDeleteDocument(doc.id);
                                                                    }
                                                                }}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                                Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Document Timeline */}
            {documents.some(d => d.expiryDate && d.status !== 'incomplete') && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Document Timeline</CardTitle>
                        <CardDescription>Expiry overview — sorted by nearest deadline</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DocumentTimeline documents={documents} />
                    </CardContent>
                </Card>
            )}

            {/* Add Document Dialog */}
            <AddDocumentDialog
                employeeId={id}
                open={showAddDoc}
                onOpenChange={setShowAddDoc}
                onSuccess={fetchEmployee}
                employee={employee}
            />

            {/* Edit Document Dialog */}
            {editingDoc && (
                <EditDocumentDialog
                    document={editingDoc}
                    open={!!editingDoc}
                    onOpenChange={(open) => !open && setEditingDoc(null)}
                    onSuccess={fetchEmployee}
                />
            )}

            {/* Renew Document Dialog */}
            {renewingDoc && (
                <RenewDocumentDialog
                    document={renewingDoc}
                    open={!!renewingDoc}
                    onOpenChange={(open) => !open && setRenewingDoc(null)}
                    onSuccess={fetchEmployee}
                />
            )}

            {/* Batch delete documents confirmation */}
            <AlertDialog open={showBatchDeleteDocs} onOpenChange={setShowBatchDeleteDocs}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedDocs.size} document{selectedDocs.size > 1 ? 's' : ''}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the selected document{selectedDocs.size > 1 ? 's' : ''}. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={batchDeletingDocs}>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={handleBatchDeleteDocs} disabled={batchDeletingDocs}>
                            {batchDeletingDocs ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
