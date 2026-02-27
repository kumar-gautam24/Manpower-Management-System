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
import { Loader2, Upload, FileText, Image, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { docDisplayName } from '@/lib/constants';
import { useDocumentTypes } from '@/hooks/use-document-types';
import type { Document, DocumentWithCompliance, EmployeeWithCompany, AdminDocumentType, MetadataFieldDef, DocumentDependency, DependencyAlert } from '@/types';

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

function requiredTag() {
    return <span className="text-red-500"> *</span>;
}

function optionalTag() {
    return <span className="text-muted-foreground font-normal"> (optional)</span>;
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
    const { types: docTypes } = useDocumentTypes();

    const [documentType, setDocumentType] = useState(preselectedType || '');
    const [documentNumber, setDocumentNumber] = useState('');
    const [issueDate, setIssueDate] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [metadata, setMetadata] = useState<Record<string, unknown>>({});
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [depAlerts, setDepAlerts] = useState<DependencyAlert[]>([]);

    useEffect(() => {
        if (!open || !employeeId) return;
        api.employees.getDependencyAlerts(employeeId)
            .then(res => setDepAlerts(res.data || []))
            .catch(() => setDepAlerts([]));
    }, [open, employeeId]);

    const config = docTypes.find(t => t.docType === documentType);
    const relevantAlerts = depAlerts.filter(a => a.blockedDoc === documentType);

    useEffect(() => {
        if (!documentType || !config) return;
        const autoMeta: Record<string, unknown> = {};
        for (const field of (config.metadataFields || [])) {
            if (field.key === 'nationality' && employee?.nationality) autoMeta.nationality = employee.nationality;
            if (field.key === 'sponsor' && employee?.companyName) autoMeta.sponsor = employee.companyName;
            if (field.key === 'job_title' && employee?.trade) autoMeta.job_title = employee.trade;
            if (field.key === 'linked_passport' && employee?.passportNumber) autoMeta.linked_passport = employee.passportNumber;
        }
        setMetadata(autoMeta);
    }, [documentType, employee, config]);

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

    const validate = (): string | null => {
        if (!config) return null;
        if (config.requireDocumentNumber && !documentNumber.trim()) return `${config.numberLabel} is required`;
        if (config.requireIssueDate && !issueDate) return 'Issue date is required';
        if (config.requireExpiryDate && !expiryDate) return `${config.expiryLabel} is required`;
        if (config.requireFile && !file) return 'File upload is required';
        return null;
    };

    const handleSubmit = async () => {
        if (!documentType) return;
        const validationError = validate();
        if (validationError) { toast.error(validationError); return; }

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
        setMetadata({});
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
                                {docTypes.map((dt) => (
                                    <button
                                        key={dt.docType}
                                        type="button"
                                        onClick={() => setDocumentType(dt.docType)}
                                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                            documentType === dt.docType
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-muted border-border text-muted-foreground hover:border-blue-400 dark:hover:border-blue-600'
                                        }`}
                                    >
                                        {dt.displayName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Dependency warnings */}
                    {documentType && relevantAlerts.length > 0 && (
                        <div className="space-y-2">
                            {relevantAlerts.map((alert, i) => (
                                <div key={i} className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                                    alert.severity === 'critical'
                                        ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                                        : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300'
                                }`}>
                                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                    <span>{alert.message}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── Fields shown after type is selected ── */}
                    {documentType && config && (
                        <>
                            {/* Custom name for "Other" type */}
                            {documentType === 'other' && (
                                <div className="space-y-2">
                                    <Label>Document Name {requiredTag()}</Label>
                                    <Input
                                        placeholder="e.g. Certificate of Good Conduct"
                                        value={String(metadata.custom_name || '')}
                                        onChange={(e) => updateMetadata('custom_name', e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Document Number */}
                            {config.showDocumentNumber && (
                                <div className="space-y-2">
                                    <Label>{config.numberLabel}{config.requireDocumentNumber ? requiredTag() : optionalTag()}</Label>
                                    <Input
                                        placeholder={config.numberPlaceholder}
                                        value={documentNumber}
                                        onChange={(e) => setDocumentNumber(e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Issue Date */}
                            {config.showIssueDate && (
                                <div className="space-y-2">
                                    <Label>Issue Date{config.requireIssueDate ? requiredTag() : optionalTag()}</Label>
                                    <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                                </div>
                            )}

                            {/* Expiry / Renewal Date */}
                            {config.showExpiryDate && (
                                <div className="space-y-2">
                                    <Label>{config.expiryLabel}{config.requireExpiryDate ? requiredTag() : optionalTag()}</Label>
                                    <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                                </div>
                            )}

                            {/* Type-specific metadata fields */}
                            {(config.metadataFields || [])
                                .filter((f: MetadataFieldDef) => f.key !== 'custom_name')
                                .map((field: MetadataFieldDef) => (
                                    <div key={field.key} className="space-y-2">
                                        <Label>
                                            {field.label}
                                            {field.required && requiredTag()}
                                        </Label>
                                        {renderMetadataField(field, metadata[field.key], updateMetadata)}
                                    </div>
                                ))}

                            {/* ── File Upload ── */}
                            {config.showFile && (
                                <div className="space-y-2">
                                    <Label>File{config.requireFile ? requiredTag() : optionalTag()}</Label>
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
                            )}
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
    const { types: docTypes } = useDocumentTypes();

    const [documentType, setDocumentType] = useState(document.documentType);
    const [documentNumber, setDocumentNumber] = useState(document.documentNumber || '');
    const [issueDate, setIssueDate] = useState(document.issueDate || '');
    const [expiryDate, setExpiryDate] = useState(document.expiryDate || '');
    const [metadata, setMetadata] = useState<Record<string, unknown>>(document.metadata || {});
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isMandatory = 'isMandatory' in document && document.isMandatory;
    const config = docTypes.find(t => t.docType === documentType);

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
                    <DialogDescription>Update the document details or file.</DialogDescription>
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
                                {docTypes.map((dt) => (
                                    <button
                                        key={dt.docType}
                                        type="button"
                                        onClick={() => setDocumentType(dt.docType)}
                                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                            documentType === dt.docType
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-muted border-border text-muted-foreground hover:border-blue-400 dark:hover:border-blue-600'
                                        }`}
                                    >
                                        {dt.displayName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {config && (
                        <>
                            {/* Custom name for "Other" type */}
                            {documentType === 'other' && (
                                <div className="space-y-2">
                                    <Label>Document Name {requiredTag()}</Label>
                                    <Input
                                        placeholder="e.g. Certificate of Good Conduct"
                                        value={String(metadata.custom_name || '')}
                                        onChange={(e) => updateMetadata('custom_name', e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Document Number */}
                            {config.showDocumentNumber && (
                                <div className="space-y-2">
                                    <Label>{config.numberLabel}{config.requireDocumentNumber ? requiredTag() : optionalTag()}</Label>
                                    <Input
                                        placeholder={config.numberPlaceholder}
                                        value={documentNumber}
                                        onChange={(e) => setDocumentNumber(e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Issue Date */}
                            {config.showIssueDate && (
                                <div className="space-y-2">
                                    <Label>Issue Date{config.requireIssueDate ? requiredTag() : optionalTag()}</Label>
                                    <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                                </div>
                            )}

                            {/* Expiry / Renewal Date */}
                            {config.showExpiryDate && (
                                <div className="space-y-2">
                                    <Label>{config.expiryLabel}{config.requireExpiryDate ? requiredTag() : optionalTag()}</Label>
                                    <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                                </div>
                            )}

                            {/* Type-specific metadata fields */}
                            {(config.metadataFields || [])
                                .filter((f: MetadataFieldDef) => f.key !== 'custom_name')
                                .map((field: MetadataFieldDef) => (
                                    <div key={field.key} className="space-y-2">
                                        <Label>
                                            {field.label}
                                            {field.required && requiredTag()}
                                        </Label>
                                        {renderMetadataField(field, metadata[field.key], updateMetadata)}
                                    </div>
                                ))}

                            {/* Replace File */}
                            {config.showFile && (
                                <div className="space-y-2">
                                    <Label>Replace File{optionalTag()}</Label>
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
                            )}
                        </>
                    )}
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
