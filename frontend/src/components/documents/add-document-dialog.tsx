'use client';

import { useState, useRef, useCallback } from 'react';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, FileText, Image, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Document, DocumentWithCompliance } from '@/types';

const DOCUMENT_TYPES = [
    'Visa', 'Passport', 'Emirates ID', 'Labor Card',
    'Medical Insurance', 'Work Permit', 'Trade License', 'Other',
];

/** Map snake_case backend type → display name for chip matching */
const DOC_TYPE_DISPLAY: Record<string, string> = {
    passport: 'Passport',
    visa: 'Visa',
    emirates_id: 'Emirates ID',
    work_permit: 'Work Permit',
    health_insurance: 'Medical Insurance',
    iloe_insurance: 'Other',
    medical_fitness: 'Other',
    labor_card: 'Labor Card',
};

/** Reverse map: display name → snake_case */
const DOC_TYPE_TO_SNAKE: Record<string, string> = {
    Passport: 'passport',
    Visa: 'visa',
    'Emirates ID': 'emirates_id',
    'Work Permit': 'work_permit',
    'Medical Insurance': 'health_insurance',
    'Labor Card': 'labor_card',
    'Trade License': 'trade_license',
};

interface AddDocumentDialogProps {
    employeeId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function AddDocumentDialog({ employeeId, open, onOpenChange, onSuccess }: AddDocumentDialogProps) {
    const [documentType, setDocumentType] = useState('');
    const [customType, setCustomType] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const selectedType = documentType === 'Other' ? customType : documentType;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (selected) {
            if (selected.size > 10 * 1024 * 1024) {
                toast.error('File too large. Maximum 10MB.');
                return;
            }
            setFile(selected);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const dropped = e.dataTransfer.files[0];
        if (dropped) {
            if (dropped.size > 10 * 1024 * 1024) {
                toast.error('File too large. Maximum 10MB.');
                return;
            }
            setFile(dropped);
        }
    }, []);

    const handleSubmit = async () => {
        if (!selectedType) return;
        setUploading(true);

        try {
            // Upload file first (if selected)
            let fileData = {
                fileUrl: '',
                fileName: '',
                fileSize: 0,
                fileType: '',
            };

            if (file) {
                const uploaded = await api.upload(file, 'documents');
                fileData = {
                    fileUrl: uploaded.url,
                    fileName: uploaded.fileName,
                    fileSize: uploaded.fileSize,
                    fileType: uploaded.fileType,
                };
            }

            // Create document record
            await api.documents.create(employeeId, {
                documentType: DOC_TYPE_TO_SNAKE[selectedType] || selectedType,
                expiryDate: expiryDate || undefined,
                fileUrl: fileData.fileUrl,
                fileName: fileData.fileName,
                fileSize: fileData.fileSize,
                fileType: fileData.fileType,
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
        setDocumentType('');
        setCustomType('');
        setExpiryDate('');
        setFile(null);
    };

    const fileIcon = file?.type.startsWith('image/') ? Image : FileText;
    const FileIcon = fileIcon;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Document</DialogTitle>
                    <DialogDescription>Upload a document and optionally set its expiry date.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Document Type Selection */}
                    <div className="space-y-2">
                        <Label>Document Type</Label>
                        <div className="flex flex-wrap gap-2">
                            {DOCUMENT_TYPES.map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setDocumentType(type)}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                    ${documentType === type
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-background text-foreground border-border hover:border-blue-300 dark:hover:border-blue-700'
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                        {documentType === 'Other' && (
                            <Input
                                placeholder="Enter document type..."
                                value={customType}
                                onChange={(e) => setCustomType(e.target.value)}
                                className="mt-2"
                            />
                        )}
                    </div>

                    {/* Expiry Date */}
                    <div className="space-y-2">
                        <Label htmlFor="expiry">Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input
                            id="expiry"
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                        />
                    </div>

                    {/* File Upload */}
                    <div className="space-y-2">
                        <Label>File (optional)</Label>
                        {file ? (
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                <FileIcon className="h-8 w-8 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
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
                                <p className="text-sm text-muted-foreground">
                                    Click or drag & drop (PDF, JPG, PNG — max 10MB)
                                </p>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={uploading || !selectedType}>
                        {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        {uploading ? 'Uploading...' : 'Add Document'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Edit Document Dialog ──────────────────────────────────────

interface EditDocumentDialogProps {
    document: Document | DocumentWithCompliance;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function EditDocumentDialog({ document, open, onOpenChange, onSuccess }: EditDocumentDialogProps) {
    const displayType = DOC_TYPE_DISPLAY[document.documentType] || document.documentType;
    const [documentType, setDocumentType] = useState(displayType);
    const [expiryDate, setExpiryDate] = useState(document.expiryDate || '');
    const [file, setFile] = useState<File | null>(null);
    const isMandatory = 'isMandatory' in document && document.isMandatory;
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSave = async () => {
        if (!documentType) return;
        setSaving(true);

        try {
            // Upload new file if changed
            let fileData: Partial<{ fileUrl: string; fileName: string; fileSize: number; fileType: string }> = {};
            if (file) {
                const uploaded = await api.upload(file, 'documents');
                fileData = {
                    fileUrl: uploaded.url,
                    fileName: uploaded.fileName,
                    fileSize: uploaded.fileSize,
                    fileType: uploaded.fileType,
                };
            }

            await api.documents.update(document.id, {
                documentType: DOC_TYPE_TO_SNAKE[documentType] || documentType,
                expiryDate: expiryDate || undefined,
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
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Document</DialogTitle>
                    <DialogDescription>Update the document type, expiry date, or file.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Document Type */}
                    <div className="space-y-2">
                        <Label>Document Type</Label>
                        {isMandatory ? (
                            <p className="text-sm font-medium text-foreground px-3 py-1.5 rounded-full bg-muted border border-border inline-block">
                                {displayType}
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {DOCUMENT_TYPES.filter(t => t !== 'Other').map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setDocumentType(type)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                        ${documentType === type
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-background text-foreground border-border hover:border-blue-300 dark:hover:border-blue-700'
                                            }`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Expiry Date */}
                    <div className="space-y-2">
                        <Label>Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                        />
                    </div>

                    {/* Replace File */}
                    <div className="space-y-2">
                        <Label>Replace File (optional)</Label>
                        {file ? (
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                                <FileText className="h-6 w-6 text-blue-600" />
                                <span className="text-sm truncate flex-1">{file.name}</span>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFile(null)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="h-4 w-4" /> Choose New File
                            </Button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            className="hidden"
                        />
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
