'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Upload, FileText, Image, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
    DOC_TYPES, docDisplayName, getDocTypeConfig,
    type DocTypeKey, type MetadataFieldDef,
} from '@/lib/constants';
import type { Document, DocumentWithCompliance, EmployeeWithCompany } from '@/types';

/** All selectable types for chip selector */
const SELECTABLE_TYPES = Object.entries(DOC_TYPES).map(([key, display]) => ({ key, display }));

// ── Shared helpers ──────────────────────────────────────────────

function renderMetadataField(
    field: MetadataFieldDef,
    value: unknown,
    onChange: (key: string, val: unknown) => void,
) {
    const strValue = value != null ? String(value) : '';

    if (field.type === 'select' && field.options) {
        return (
            <Select value={strValue} onValueChange={(v) => onChange(field.key, v)}>
                <SelectTrigger><SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} /></SelectTrigger>
                <SelectContent>
                    {field.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return (
        <Input
            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
            placeholder={field.placeholder}
            value={strValue}
            onChange={(e) => onChange(field.key, field.type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value)}
        />
    );
}

// ── Add Document Dialog ─────────────────────────────────────────

interface AddDocumentDialogProps {
    employeeId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    preselectedType?: string;
    employee?: EmployeeWithCompany;
}

export function AddDocumentDialog({ employeeId, open, onOpenChange, onSuccess, preselectedType, employee }: AddDocumentDialogProps) {
    const [documentType, setDocumentType] = useState(preselectedType || '');
    const [documentNumber, setDocumentNumber] = useState('');
    const [issueDate, setIssueDate] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [gracePeriodDays, setGracePeriodDays] = useState(0);
    const [finePerDay, setFinePerDay] = useState(0);
    const [fineType, setFineType] = useState<string>('daily');
    const [fineCap, setFineCap] = useState(0);
    const [metadata, setMetadata] = useState<Record<string, unknown>>({});
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const config = getDocTypeConfig(documentType);

    // When type changes, auto-fill defaults
    useEffect(() => {
        if (!documentType) return;
        const cfg = getDocTypeConfig(documentType);
        setGracePeriodDays(cfg.defaultGraceDays);
        setFinePerDay(cfg.defaultFinePerDay);
        setFineType(cfg.defaultFineType);
        setFineCap(cfg.defaultFineCap);

        // Auto-fill metadata from employee context
        const autoMeta: Record<string, unknown> = {};
        for (const field of cfg.metadataFields) {
            if (field.key === 'nationality' && employee?.nationality) autoMeta.nationality = employee.nationality;
            if (field.key === 'sponsor' && employee?.companyName) autoMeta.sponsor = employee.companyName;
            if (field.key === 'job_title' && employee?.trade) autoMeta.job_title = employee.trade;
            if (field.key === 'linked_passport' && employee?.passportNumber) autoMeta.linked_passport = employee.passportNumber;
        }
        setMetadata(autoMeta);
    }, [documentType, employee]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (selected) {
            if (selected.size > 10 * 1024 * 1024) { toast.error('File too large. Maximum 10MB.'); return; }
            setFile(selected);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const dropped = e.dataTransfer.files[0];
        if (dropped) {
            if (dropped.size > 10 * 1024 * 1024) { toast.error('File too large. Maximum 10MB.'); return; }
            setFile(dropped);
        }
    }, []);

    const updateMetadata = (key: string, val: unknown) => {
        setMetadata((prev) => ({ ...prev, [key]: val }));
    };

    const handleSubmit = async () => {
        if (!documentType) return;
        setUploading(true);

        try {
            let fileData = { fileUrl: '', fileName: '', fileSize: 0, fileType: '' };
            if (file) {
                const uploaded = await api.upload(file, 'documents');
                fileData = { fileUrl: uploaded.url, fileName: uploaded.fileName, fileSize: uploaded.fileSize, fileType: uploaded.fileType };
            }

            await api.documents.create(employeeId, {
                documentType,
                documentNumber: documentNumber || undefined,
                issueDate: issueDate || undefined,
                expiryDate: expiryDate || undefined,
                gracePeriodDays,
                finePerDay,
                fineType,
                fineCap,
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                ...fileData,
            });

            toast.success('Document added successfully');
            onSuccess();
            onOpenChange(false);
            resetForm();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to add document');
        } finally {
            setUploading(false);
        }
    };

    const resetForm = () => {
        setDocumentType(preselectedType || '');
        setDocumentNumber('');
        setIssueDate('');
        setExpiryDate('');
        setGracePeriodDays(0);
        setFinePerDay(0);
        setFineType('daily');
        setFineCap(0);
        setMetadata({});
        setShowAdvanced(false);
        setFile(null);
    };

    const FileIcon = file?.type.startsWith('image/') ? Image : FileText;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add Document</DialogTitle>
                    <DialogDescription>Add a document with its details and optionally upload a file.</DialogDescription>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto space-y-4 py-2 pr-1">
                    {/* ── Document Type — Chip Selector ── */}
                    <div className="space-y-2">
                        <Label>Document Type</Label>
                        {preselectedType ? (
                            <p className="text-sm font-medium text-foreground px-3 py-1.5 rounded-lg bg-muted border border-border inline-block">
                                {docDisplayName(preselectedType)}
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {SELECTABLE_TYPES.map(({ key, display }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setDocumentType(key)}
                                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                            documentType === key
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-muted border-border text-muted-foreground hover:border-blue-400 dark:hover:border-blue-600'
                                        }`}
                                    >
                                        {display}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Fields shown after type is selected ── */}
                    {documentType && (
                        <>
                            {/* Custom name for "Other" type */}
                            {documentType === 'other' && (
                                <div className="space-y-2">
                                    <Label>Document Name <span className="text-red-500">*</span></Label>
                                    <Input
                                        placeholder="e.g. Certificate of Good Conduct"
                                        value={String(metadata.custom_name || '')}
                                        onChange={(e) => updateMetadata('custom_name', e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Document Number */}
                            <div className="space-y-2">
                                <Label>{config.numberLabel}</Label>
                                <Input
                                    placeholder={config.numberPlaceholder}
                                    value={documentNumber}
                                    onChange={(e) => setDocumentNumber(e.target.value)}
                                />
                            </div>

                            {/* Issue Date */}
                            <div className="space-y-2">
                                <Label>Issue Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                            </div>

                            {/* Expiry / Renewal Date */}
                            <div className="space-y-2">
                                {/* TODO: consider adding min={today} to prevent past dates in production */}
                                <Label>{config.expiryLabel} <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                            </div>

                            {/* Grace Period */}
                            <div className="space-y-2">
                                <Label>Grace Period (days)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={gracePeriodDays}
                                    onChange={(e) => setGracePeriodDays(parseInt(e.target.value) || 0)}
                                />
                                {config.defaultGraceDays > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        UAE default for {DOC_TYPES[documentType as DocTypeKey] || documentType}: {config.defaultGraceDays} days
                                    </p>
                                )}
                            </div>

                            {/* Type-specific metadata fields */}
                            {config.metadataFields
                                .filter((f) => f.key !== 'custom_name')
                                .map((field) => (
                                    <div key={field.key} className="space-y-2">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500"> *</span>}
                                        </Label>
                                        {renderMetadataField(field, metadata[field.key], updateMetadata)}
                                    </div>
                                ))}

                            {/* ── Advanced: Fine Configuration ── */}
                            <button
                                type="button"
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setShowAdvanced(!showAdvanced)}
                            >
                                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                Fine Configuration
                            </button>

                            {showAdvanced && (
                                <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Fine Rate (AED)</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={finePerDay}
                                            onChange={(e) => setFinePerDay(parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Fine Type</Label>
                                        <Select value={fineType} onValueChange={setFineType}>
                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="daily">Per Day</SelectItem>
                                                <SelectItem value="monthly">Per Month</SelectItem>
                                                <SelectItem value="one_time">One-time</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Cap (AED)</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={fineCap}
                                            onChange={(e) => setFineCap(parseFloat(e.target.value) || 0)}
                                            placeholder="0 = no cap"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ── File Upload ── */}
                            <div className="space-y-2">
                                <Label>File <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                {file ? (
                                    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                        <FileIcon className="h-8 w-8 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{file.name}</p>
                                            <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFile(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div
                                        onDrop={handleDrop}
                                        onDragOver={(e) => e.preventDefault()}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-border cursor-pointer
                                            hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                                    >
                                        <Upload className="h-6 w-6 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">Click or drag & drop (PDF, JPG, PNG — max 10MB)</p>
                                    </div>
                                )}
                                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} className="hidden" />
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={uploading || !documentType}>
                        {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        {uploading ? 'Uploading...' : 'Add Document'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Edit Document Dialog ────────────────────────────────────────

interface EditDocumentDialogProps {
    document: Document | DocumentWithCompliance;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function EditDocumentDialog({ document, open, onOpenChange, onSuccess }: EditDocumentDialogProps) {
    const [documentType, setDocumentType] = useState(document.documentType);
    const [documentNumber, setDocumentNumber] = useState(document.documentNumber || '');
    const [issueDate, setIssueDate] = useState(document.issueDate || '');
    const [expiryDate, setExpiryDate] = useState(document.expiryDate || '');
    const [gracePeriodDays, setGracePeriodDays] = useState(document.gracePeriodDays || 0);
    const [finePerDay, setFinePerDay] = useState(document.finePerDay || 0);
    const [fineType, setFineType] = useState(document.fineType || 'daily');
    const [fineCap, setFineCap] = useState(document.fineCap || 0);
    const [metadata, setMetadata] = useState<Record<string, unknown>>(document.metadata || {});
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isMandatory = 'isMandatory' in document && document.isMandatory;
    const config = getDocTypeConfig(documentType);

    const updateMetadata = (key: string, val: unknown) => {
        setMetadata((prev) => ({ ...prev, [key]: val }));
    };

    const handleSave = async () => {
        if (!documentType) return;
        setSaving(true);

        try {
            let fileData: Partial<{ fileUrl: string; fileName: string; fileSize: number; fileType: string }> = {};
            if (file) {
                const uploaded = await api.upload(file, 'documents');
                fileData = { fileUrl: uploaded.url, fileName: uploaded.fileName, fileSize: uploaded.fileSize, fileType: uploaded.fileType };
            }

            await api.documents.update(document.id, {
                documentType,
                documentNumber: documentNumber || undefined,
                issueDate: issueDate || undefined,
                expiryDate: expiryDate || undefined,
                gracePeriodDays,
                finePerDay,
                fineType,
                fineCap,
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                ...fileData,
            });

            toast.success('Document updated');
            onSuccess();
            onOpenChange(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit Document</DialogTitle>
                    <DialogDescription>Update the document details, compliance settings, or file.</DialogDescription>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto space-y-4 py-2 pr-1">
                    {/* Document Type */}
                    <div className="space-y-2">
                        <Label>Document Type</Label>
                        {isMandatory ? (
                            <p className="text-sm font-medium text-foreground px-3 py-1.5 rounded-lg bg-muted border border-border inline-block">
                                {docDisplayName(document.documentType, document.metadata)}
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {SELECTABLE_TYPES.map(({ key, display }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setDocumentType(key)}
                                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                            documentType === key
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-muted border-border text-muted-foreground hover:border-blue-400 dark:hover:border-blue-600'
                                        }`}
                                    >
                                        {display}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Custom name for "Other" type */}
                    {documentType === 'other' && (
                        <div className="space-y-2">
                            <Label>Document Name <span className="text-red-500">*</span></Label>
                            <Input
                                placeholder="e.g. Certificate of Good Conduct"
                                value={String(metadata.custom_name || '')}
                                onChange={(e) => updateMetadata('custom_name', e.target.value)}
                            />
                        </div>
                    )}

                    {/* Document Number */}
                    <div className="space-y-2">
                        <Label>{config.numberLabel}</Label>
                        <Input
                            placeholder={config.numberPlaceholder}
                            value={documentNumber}
                            onChange={(e) => setDocumentNumber(e.target.value)}
                        />
                    </div>

                    {/* Issue Date */}
                    <div className="space-y-2">
                        <Label>Issue Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>

                    {/* Expiry / Renewal Date */}
                    <div className="space-y-2">
                        {/* TODO: consider adding min={today} to prevent past dates in production */}
                        <Label>{config.expiryLabel} <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                    </div>

                    {/* Grace Period */}
                    <div className="space-y-2">
                        <Label>Grace Period (days)</Label>
                        <Input
                            type="number"
                            min={0}
                            value={gracePeriodDays}
                            onChange={(e) => setGracePeriodDays(parseInt(e.target.value) || 0)}
                        />
                    </div>

                    {/* Type-specific metadata fields */}
                    {config.metadataFields
                        .filter((f) => f.key !== 'custom_name')
                        .map((field) => (
                            <div key={field.key} className="space-y-2">
                                <Label>
                                    {field.label}
                                    {field.required && <span className="text-red-500"> *</span>}
                                </Label>
                                {renderMetadataField(field, metadata[field.key], updateMetadata)}
                            </div>
                        ))}

                    {/* Advanced: Fine Configuration */}
                    <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                        {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        Fine Configuration
                    </button>

                    {showAdvanced && (
                        <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border border-border bg-muted/30">
                            <div className="space-y-1">
                                <Label className="text-xs">Fine Rate (AED)</Label>
                                <Input
                                    type="number" min={0} step="0.01"
                                    value={finePerDay}
                                    onChange={(e) => setFinePerDay(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Fine Type</Label>
                                <Select value={fineType} onValueChange={setFineType}>
                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="daily">Per Day</SelectItem>
                                        <SelectItem value="monthly">Per Month</SelectItem>
                                        <SelectItem value="one_time">One-time</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Cap (AED)</Label>
                                <Input
                                    type="number" min={0} step="0.01"
                                    value={fineCap}
                                    onChange={(e) => setFineCap(parseFloat(e.target.value) || 0)}
                                    placeholder="0 = no cap"
                                />
                            </div>
                        </div>
                    )}

                    {/* Replace File */}
                    <div className="space-y-2">
                        <Label>Replace File <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        {file ? (
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                <FileText className="h-6 w-6 text-blue-600" />
                                <span className="text-sm truncate flex-1">{file.name}</span>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFile(null)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                                <Upload className="h-4 w-4" /> Choose New File
                            </Button>
                        )}
                        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !documentType}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
