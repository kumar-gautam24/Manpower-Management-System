'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    ArrowLeft, Pencil, Trash2, Phone, Building2, Calendar,
    Briefcase, FileText, Plus, Loader2, AlertTriangle, XCircle, CheckCircle, Star, RefreshCw,
    DollarSign, MapPin, Globe, User,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { EmployeeWithCompany, DocumentWithCompliance } from '@/types';
import { toast } from 'sonner';
import { AddDocumentDialog, EditDocumentDialog } from '@/components/documents/add-document-dialog';
import { RenewDocumentDialog } from '@/components/documents/renew-document-dialog';
import { useUser } from '@/hooks/use-user';

/** Calculate document expiry status and days remaining */
function getDocStatus(expiryDate: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'Expired', color: 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 border-red-200 dark:border-red-900', icon: XCircle, days: diffDays, priority: 0 };
    if (diffDays <= 7) return { label: 'Urgent', color: 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 border-orange-200 dark:border-orange-900', icon: AlertTriangle, days: diffDays, priority: 1 };
    if (diffDays <= 30) return { label: 'Expiring', color: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900', icon: AlertTriangle, days: diffDays, priority: 2 };
    return { label: 'Valid', color: 'bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400 border-green-200 dark:border-green-900', icon: CheckCircle, days: diffDays, priority: 3 };
}

/** Check if a doc slot is incomplete (no data filled in yet) */
function isIncomplete(doc: DocumentWithCompliance): boolean {
    return !doc.expiryDate && !doc.fileUrl;
}

/** Sort: expired/urgent first, then expiring, valid, pending last */
function sortDocs(docs: DocumentWithCompliance[]): DocumentWithCompliance[] {
    return [...docs].sort((a, b) => {
        const aIncomplete = isIncomplete(a);
        const bIncomplete = isIncomplete(b);
        if (aIncomplete && !bIncomplete) return 1;
        if (!aIncomplete && bIncomplete) return -1;
        if (aIncomplete && bIncomplete) return 0;

        const aStatus = a.expiryDate ? getDocStatus(a.expiryDate) : null;
        const bStatus = b.expiryDate ? getDocStatus(b.expiryDate) : null;
        return (aStatus?.priority ?? 99) - (bStatus?.priority ?? 99);
    });
}

export default function EmployeeDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const [employee, setEmployee] = useState<EmployeeWithCompany | null>(null);
    const [documents, setDocuments] = useState<DocumentWithCompliance[]>([]);
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

    const toggleDocSelect = (id: string) => {
        setSelectedDocs(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
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
                <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
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

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Back button */}
            <Link href="/employees" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to employees
            </Link>

            {/* Employee Info Card */}
            <Card className="border-border/60">
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

            {/* Profile Details Card — only if any optional field exists */}
            {(employee.gender || employee.dateOfBirth || employee.nationality || employee.passportNumber || employee.nativeLocation || employee.currentLocation || employee.salary || employee.status) && (
                <Card className="border-border/60">
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
                                    <Badge variant="outline" className={employee.status === 'active' ? 'bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400' : employee.status === 'on_leave' ? 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400' : 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400'}>
                                        {employee.status === 'on_leave' ? 'On Leave' : employee.status.charAt(0).toUpperCase() + employee.status.slice(1)}
                                    </Badge>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Documents Section */}
            <Card className="border-border/60">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Documents</CardTitle>
                            <CardDescription>{documents.length} document{documents.length !== 1 ? 's' : ''}</CardDescription>
                        </div>
                        {isAdmin && (
                            <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => setShowAddDoc(true)}>
                                    <Plus className="h-4 w-4 mr-1" /> Add Document
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Document selection toolbar */}
                    {isAdmin && selectedDocs.size > 0 && (
                        <div className="mt-3 flex items-center gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
                            <button
                                onClick={toggleDocSelectAll}
                                className="h-4 w-4 rounded border-2 border-red-400 flex items-center justify-center flex-shrink-0 cursor-pointer"
                            >
                                {selectedDocs.size === documents.length && (
                                    <CheckCircle className="h-3 w-3 text-red-500" />
                                )}
                            </button>
                            <span className="text-sm font-medium text-red-700 dark:text-red-400">
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
                                        className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                                            }`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })()}
                </CardHeader>
                <CardContent>
                    {documents.length === 0 ? (
                        <div className="text-center py-8">
                            <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                            <p className="text-muted-foreground">No documents yet. Add one to start tracking.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sortDocs(documents).map((doc) => {
                                const pending = isIncomplete(doc);
                                const hasExpiry = !!doc.expiryDate;
                                const status = hasExpiry ? getDocStatus(doc.expiryDate!) : null;
                                const StatusIcon = status?.icon || FileText;
                                const isPrimary = doc.isPrimary;
                                const docName = doc.displayName || doc.documentType;

                                return (
                                    <div
                                        key={doc.id}
                                        className={`flex items-center justify-between p-3.5 rounded-lg border transition-shadow hover:shadow-sm ${selectedDocs.has(doc.id)
                                            ? 'border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10'
                                            : pending
                                                ? 'border-dashed border-border/80 bg-muted/20 opacity-70'
                                                : 'border-border/60'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            {/* Document checkbox (admin only) */}
                                            {isAdmin && (
                                                <button
                                                    onClick={() => toggleDocSelect(doc.id)}
                                                    className={`h-4 w-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer
                                                        ${selectedDocs.has(doc.id)
                                                            ? 'bg-red-500 border-red-500'
                                                            : 'border-gray-300 dark:border-gray-600 hover:border-red-400'}
                                                    `}
                                                >
                                                    {selectedDocs.has(doc.id) && (
                                                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                    )}
                                                </button>
                                            )}
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${pending ? 'bg-muted text-muted-foreground' : status?.color || 'bg-muted text-muted-foreground'
                                                }`}>
                                                <StatusIcon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="font-medium text-foreground text-sm">{docName}</h4>
                                                    {isPrimary && (
                                                        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {pending
                                                        ? 'Not yet submitted'
                                                        : hasExpiry
                                                            ? `Expires: ${doc.expiryDate}`
                                                            : 'No expiry date'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 ml-3">
                                            {/* Days countdown */}
                                            {!pending && hasExpiry && status && (
                                                <div className="text-right hidden sm:block">
                                                    <div className={`text-base font-bold ${status.days < 0 ? 'text-red-600' : status.days <= 7 ? 'text-orange-600' : status.days <= 30 ? 'text-yellow-600' : 'text-green-600'}`}>
                                                        {Math.abs(status.days)}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground leading-tight">
                                                        {status.days < 0 ? 'overdue' : 'days left'}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Status badge */}
                                            <Badge variant="outline" className={`text-xs ${pending
                                                ? 'bg-muted text-muted-foreground border-border'
                                                : status?.color || 'bg-muted text-muted-foreground border-border'
                                                }`}>
                                                {pending ? 'Pending' : status?.label || 'No Expiry'}
                                            </Badge>

                                            {/* Admin Actions */}
                                            {isAdmin && (
                                                <>
                                                    {/* Toggle primary */}
                                                    {hasExpiry && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title={isPrimary ? 'Unset as tracked document' : 'Set as tracked document'}
                                                            className={`h-7 w-7 ${isPrimary ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}`}
                                                            onClick={async () => {
                                                                try {
                                                                    await api.documents.togglePrimary(doc.id);
                                                                    toast.success(isPrimary ? 'Unset as tracked' : 'Set as tracked document');
                                                                    fetchEmployee();
                                                                } catch {
                                                                    toast.error('Failed to toggle');
                                                                }
                                                            }}
                                                        >
                                                            <Star className={`h-3.5 w-3.5 ${isPrimary ? 'fill-current' : ''}`} />
                                                        </Button>
                                                    )}

                                                    {/* Renew */}
                                                    {hasExpiry && (
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            title="Renew Document"
                                                            className="h-7 w-7 text-muted-foreground hover:text-blue-600"
                                                            onClick={() => setRenewingDoc(doc)}
                                                        >
                                                            <RefreshCw className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}

                                                    {/* Edit */}
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                        onClick={() => setEditingDoc(doc)}
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>

                                                    {/* Delete */}
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete {docName}?</AlertDialogTitle>
                                                                <AlertDialogDescription>This will permanently delete this document record.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDeleteDocument(doc.id)} className="bg-red-600 hover:bg-red-700">
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add Document Dialog */}
            <AddDocumentDialog
                employeeId={id}
                open={showAddDoc}
                onOpenChange={setShowAddDoc}
                onSuccess={fetchEmployee}
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
