'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { api } from '@/lib/api';
import type { Company, ComplianceRuleRow, AdminDocumentType } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Save, Plus, Pencil, Trash2, Info } from 'lucide-react';
import { toast } from 'sonner';

type Tab = 'rules' | 'types';

export default function SettingsPage() {
    const { isAdmin, loading: authLoading } = useUser();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<Tab>('rules');

    useEffect(() => {
        if (!authLoading && !isAdmin) {
            router.push('/');
        }
    }, [authLoading, isAdmin, router]);

    if (authLoading) {
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
                <h1 className="text-2xl font-bold text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure compliance rules and document types.
                </p>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 border-b border-border">
                <button
                    onClick={() => setActiveTab('rules')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'rules'
                            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Compliance Rules
                </button>
                <button
                    onClick={() => setActiveTab('types')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'types'
                            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Document Types
                </button>
            </div>

            {activeTab === 'rules' && <ComplianceRulesTab />}
            {activeTab === 'types' && <DocumentTypesTab />}
        </div>
    );
}

// ── Compliance Rules Tab ─────────────────────────────────────

function ComplianceRulesTab() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const GLOBAL_VALUE = '__global__';
    const [selectedCompany, setSelectedCompany] = useState<string>(GLOBAL_VALUE);
    const [rules, setRules] = useState<ComplianceRuleRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchCompanies = useCallback(async () => {
        try {
            const res = await api.companies.list();
            setCompanies(res.data);
        } catch { /* ignore */ }
    }, []);

    const fetchRules = useCallback(async (companyId?: string) => {
        setLoading(true);
        try {
            const res = await api.complianceRules.list(companyId || undefined);
            setRules(res.data);
        } catch {
            toast.error('Failed to fetch compliance rules');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
    const companyId = selectedCompany === GLOBAL_VALUE ? undefined : selectedCompany;
    useEffect(() => { fetchRules(companyId); }, [companyId, fetchRules]);

    const updateRule = (index: number, field: string, value: unknown) => {
        setRules(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.complianceRules.upsert({
                companyId: companyId || null,
                rules: rules.map(r => ({
                    docType: r.docType,
                    gracePeriodDays: r.gracePeriodDays,
                    finePerDay: r.finePerDay,
                    fineType: r.fineType,
                    fineCap: r.fineCap,
                    isMandatory: companyId ? r.companyMandatory : null,
                })),
            });
            toast.success('Compliance rules saved');
        } catch {
            toast.error('Failed to save rules');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-lg">Compliance Rules</CardTitle>
                        <CardDescription className="flex items-center gap-1 mt-1">
                            <Info className="h-3.5 w-3.5" />
                            Changes only affect new employees. Existing documents keep their current values.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                        <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                            <SelectTrigger className="w-52">
                                <SelectValue placeholder="Global Defaults" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={GLOBAL_VALUE}>Global Defaults</SelectItem>
                                {companies.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button onClick={handleSave} disabled={saving} size="sm">
                            <Save className="h-4 w-4 mr-1.5" />
                            {saving ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    {companyId && (
                                        <th className="text-left py-3 px-3 font-medium text-muted-foreground">Mandatory</th>
                                    )}
                                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Document Type</th>
                                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Grace Period (days)</th>
                                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Fine Rate (AED)</th>
                                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Fine Type</th>
                                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Fine Cap (AED)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rules.map((rule, i) => (
                                    <tr key={rule.docType} className="border-b border-border/50">
                                        {companyId && (
                                            <td className="py-2 px-3">
                                                <Checkbox
                                                    checked={rule.companyMandatory ?? rule.globalMandatory}
                                                    onCheckedChange={(checked) =>
                                                        updateRule(i, 'companyMandatory', checked === true)
                                                    }
                                                />
                                            </td>
                                        )}
                                        <td className="py-2 px-3 font-medium text-foreground">
                                            {rule.displayName}
                                            {rule.globalMandatory && !companyId && (
                                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                                                    mandatory
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3">
                                            <Input
                                                type="number"
                                                className="w-24 h-8 text-sm"
                                                value={rule.gracePeriodDays}
                                                onChange={(e) => updateRule(i, 'gracePeriodDays', parseInt(e.target.value) || 0)}
                                                min={0}
                                            />
                                        </td>
                                        <td className="py-2 px-3">
                                            <Input
                                                type="number"
                                                className="w-28 h-8 text-sm"
                                                value={rule.finePerDay}
                                                onChange={(e) => updateRule(i, 'finePerDay', parseFloat(e.target.value) || 0)}
                                                min={0}
                                                step="0.01"
                                            />
                                        </td>
                                        <td className="py-2 px-3">
                                            <Select
                                                value={rule.fineType}
                                                onValueChange={(val) => updateRule(i, 'fineType', val)}
                                            >
                                                <SelectTrigger className="w-32 h-8 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="daily">Per Day</SelectItem>
                                                    <SelectItem value="monthly">Per Month</SelectItem>
                                                    <SelectItem value="one_time">One-time</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </td>
                                        <td className="py-2 px-3">
                                            <Input
                                                type="number"
                                                className="w-32 h-8 text-sm"
                                                value={rule.fineCap}
                                                onChange={(e) => updateRule(i, 'fineCap', parseFloat(e.target.value) || 0)}
                                                min={0}
                                                step="0.01"
                                                placeholder="0 = no cap"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {rules.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground">
                                No document types found. Run migration 007 first.
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Document Types Tab ───────────────────────────────────────

function DocumentTypesTab() {
    const [types, setTypes] = useState<AdminDocumentType[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingType, setEditingType] = useState<AdminDocumentType | null>(null);

    const fetchTypes = useCallback(async () => {
        try {
            const res = await api.documentTypes.list();
            setTypes(res.data);
        } catch {
            toast.error('Failed to fetch document types');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTypes(); }, [fetchTypes]);

    const handleDelete = async (id: string) => {
        try {
            await api.documentTypes.delete(id);
            setTypes(prev => prev.filter(t => t.id !== id));
            toast.success('Document type deleted');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to delete';
            toast.error(message);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-lg">Document Types</CardTitle>
                        <CardDescription>
                            Manage document types. System types can be edited but not deleted.
                        </CardDescription>
                    </div>
                    <Dialog open={dialogOpen} onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setEditingType(null);
                    }}>
                        <DialogTrigger asChild>
                            <Button size="sm" onClick={() => setEditingType(null)}>
                                <Plus className="h-4 w-4 mr-1.5" /> Add Type
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>
                                    {editingType ? 'Edit Document Type' : 'Add Document Type'}
                                </DialogTitle>
                            </DialogHeader>
                            <DocumentTypeForm
                                initial={editingType}
                                onSuccess={() => {
                                    setDialogOpen(false);
                                    setEditingType(null);
                                    fetchTypes();
                                }}
                            />
                        </DialogContent>
                    </Dialog>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Display Name</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Slug</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Mandatory</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Order</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {types.map((dt) => (
                                    <tr key={dt.id} className="border-b border-border/50 hover:bg-accent/30">
                                        <td className="py-3 px-4 font-medium text-foreground">{dt.displayName}</td>
                                        <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{dt.docType}</td>
                                        <td className="py-3 px-4">
                                            {dt.isMandatory ? (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                                                    Mandatory
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Optional</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground">{dt.sortOrder}</td>
                                        <td className="py-3 px-4">
                                            {dt.isSystem ? (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                                    System
                                                </span>
                                            ) : (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400">
                                                    Custom
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => {
                                                        setEditingType(dt);
                                                        setDialogOpen(true);
                                                    }}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                {!dt.isSystem && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Document Type</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Delete &quot;{dt.displayName}&quot;? Existing documents of this type will be preserved.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={() => handleDelete(dt.id)}
                                                                    className="bg-red-600 hover:bg-red-700"
                                                                >
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {types.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground">
                                No document types found. Run migration 007 first.
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Document Type Form ───────────────────────────────────────

function FieldToggle({
    label,
    show,
    required,
    onShowChange,
    onRequiredChange,
}: {
    label: string;
    show: boolean;
    required: boolean;
    onShowChange: (v: boolean) => void;
    onRequiredChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
                <Checkbox checked={show} onCheckedChange={(v) => { onShowChange(v === true); if (!v) onRequiredChange(false); }} />
                <span className="text-sm">{label}</span>
            </div>
            {show && (
                <Select value={required ? 'required' : 'optional'} onValueChange={(v) => onRequiredChange(v === 'required')}>
                    <SelectTrigger className="w-28 h-7 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="optional">Optional</SelectItem>
                        <SelectItem value="required">Required</SelectItem>
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}

function DocumentTypeForm({
    initial,
    onSuccess,
}: {
    initial: AdminDocumentType | null;
    onSuccess: () => void;
}) {
    const isEditing = !!initial;
    const isSystem = initial?.isSystem ?? false;

    const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
    const [docType, setDocType] = useState(initial?.docType ?? '');
    const [numberLabel, setNumberLabel] = useState(initial?.numberLabel ?? 'Document Number');
    const [numberPlaceholder, setNumberPlaceholder] = useState(initial?.numberPlaceholder ?? '');
    const [expiryLabel, setExpiryLabel] = useState(initial?.expiryLabel ?? 'Expiry Date');
    const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 100);
    const [saving, setSaving] = useState(false);

    const [showDocumentNumber, setShowDocumentNumber] = useState(initial?.showDocumentNumber ?? true);
    const [requireDocumentNumber, setRequireDocumentNumber] = useState(initial?.requireDocumentNumber ?? false);
    const [showIssueDate, setShowIssueDate] = useState(initial?.showIssueDate ?? true);
    const [requireIssueDate, setRequireIssueDate] = useState(initial?.requireIssueDate ?? false);
    const [showExpiryDate, setShowExpiryDate] = useState(initial?.showExpiryDate ?? true);
    const [requireExpiryDate, setRequireExpiryDate] = useState(initial?.requireExpiryDate ?? false);
    const [showFile, setShowFile] = useState(initial?.showFile ?? true);
    const [requireFile, setRequireFile] = useState(initial?.requireFile ?? false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        const fieldConfig = {
            showDocumentNumber,
            requireDocumentNumber,
            showIssueDate,
            requireIssueDate,
            showExpiryDate,
            requireExpiryDate,
            showFile,
            requireFile,
        };

        try {
            if (isEditing && initial) {
                await api.documentTypes.update(initial.id, {
                    displayName,
                    numberLabel,
                    numberPlaceholder,
                    expiryLabel,
                    sortOrder,
                    ...fieldConfig,
                });
                toast.success('Document type updated');
            } else {
                await api.documentTypes.create({
                    docType,
                    displayName,
                    numberLabel,
                    numberPlaceholder,
                    expiryLabel,
                    sortOrder,
                    hasExpiry: showExpiryDate,
                    ...fieldConfig,
                });
                toast.success('Document type created');
            }
            onSuccess();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to save';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {!isEditing && (
                <div>
                    <label className="text-sm font-medium text-foreground">Slug (internal key)</label>
                    <Input
                        value={docType}
                        onChange={(e) => setDocType(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                        placeholder="e.g. safety_certificate"
                        className="mt-1"
                        required
                    />
                    <p className="text-xs text-muted-foreground mt-1">Lowercase, underscores only. Cannot be changed later.</p>
                </div>
            )}
            <div>
                <label className="text-sm font-medium text-foreground">Display Name</label>
                <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Safety Certificate"
                    className="mt-1"
                    required
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-foreground">Number Label</label>
                    <Input
                        value={numberLabel}
                        onChange={(e) => setNumberLabel(e.target.value)}
                        placeholder="e.g. Certificate Number"
                        className="mt-1"
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-foreground">Number Placeholder</label>
                    <Input
                        value={numberPlaceholder}
                        onChange={(e) => setNumberPlaceholder(e.target.value)}
                        placeholder="e.g. CERT-12345"
                        className="mt-1"
                    />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-foreground">Expiry Label</label>
                    <Input
                        value={expiryLabel}
                        onChange={(e) => setExpiryLabel(e.target.value)}
                        placeholder="e.g. Valid Until"
                        className="mt-1"
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-foreground">Sort Order</label>
                    <Input
                        type="number"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(parseInt(e.target.value) || 100)}
                        className="mt-1"
                        min={1}
                    />
                </div>
            </div>

            {/* Field Visibility & Requirements */}
            <div>
                <label className="text-sm font-medium text-foreground">Fields</label>
                <div className="mt-1 border rounded-lg p-3 space-y-1">
                    <FieldToggle
                        label="Document Number"
                        show={showDocumentNumber}
                        required={requireDocumentNumber}
                        onShowChange={setShowDocumentNumber}
                        onRequiredChange={setRequireDocumentNumber}
                    />
                    <FieldToggle
                        label="Issue Date"
                        show={showIssueDate}
                        required={requireIssueDate}
                        onShowChange={setShowIssueDate}
                        onRequiredChange={setRequireIssueDate}
                    />
                    <FieldToggle
                        label="Expiry Date"
                        show={showExpiryDate}
                        required={requireExpiryDate}
                        onShowChange={setShowExpiryDate}
                        onRequiredChange={setRequireExpiryDate}
                    />
                    <FieldToggle
                        label="File Upload"
                        show={showFile}
                        required={requireFile}
                        onShowChange={setShowFile}
                        onRequiredChange={setRequireFile}
                    />
                </div>
            </div>

            {isSystem && (
                <p className="text-xs text-muted-foreground bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded p-2">
                    This is a system document type. You can edit labels and field config but not metadata fields or slug.
                </p>
            )}
            <Button type="submit" disabled={saving} className="w-full">
                {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
        </form>
    );
}
