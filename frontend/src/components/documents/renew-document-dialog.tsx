'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, FileText, Image, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { docDisplayName } from '@/lib/constants';
import { useDocumentTypes } from '@/hooks/use-document-types';
import type { Document, DocumentWithCompliance, DependencyAlert } from '@/types';

interface RenewDocumentDialogProps {
    document: Document | DocumentWithCompliance;
    employeeId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function RenewDocumentDialog({ document, employeeId, open, onOpenChange, onSuccess }: RenewDocumentDialogProps) {
    const { types: docTypes } = useDocumentTypes();
    const [documentNumber, setDocumentNumber] = useState(document.documentNumber || '');
    const [depAlerts, setDepAlerts] = useState<DependencyAlert[]>([]);

    useEffect(() => {
        const empId = employeeId || document.employeeId;
        if (!open || !empId) return;
        api.employees.getDependencyAlerts(empId)
            .then(res => setDepAlerts((res.data || []).filter(a => a.blockedDoc === document.documentType)))
            .catch(() => setDepAlerts([]));
    }, [open, employeeId, document.employeeId, document.documentType]);
    const [issueDate, setIssueDate] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const config = docTypes.find(t => t.docType === document.documentType);

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
        if (!expiryDate) {
            toast.error('New expiry date is required');
            return;
        }
        setUploading(true);

        try {
            // Upload file first (if selected)
            let fileData = {};

            if (file) {
                const uploaded = await api.upload(file, 'documents');
                fileData = {
                    fileUrl: uploaded.url,
                    fileName: uploaded.fileName,
                    fileSize: uploaded.fileSize,
                    fileType: uploaded.fileType,
                };
            }

            // Call renew API
            await api.documents.renew(document.id, {
                expiryDate,
                documentNumber: documentNumber || undefined,
                issueDate: issueDate || undefined,
                ...fileData,
            });

            toast.success('Document renewed successfully');
            onSuccess();
            onOpenChange(false);
            resetForm();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to renew document');
        } finally {
            setUploading(false);
        }
    };

    const resetForm = () => {
        setDocumentNumber(document.documentNumber || '');
        setIssueDate('');
        setExpiryDate('');
        setFile(null);
    };

    const fileIcon = file?.type.startsWith('image/') ? Image : FileText;
    const FileIcon = fileIcon;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Renew {docDisplayName(document.documentType)}</DialogTitle>
                    <DialogDescription>
                        {document.expiryDate
                            ? `Current expiry: ${new Date(document.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. `
                            : ''}
                        The old version will be archived.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Dependency warnings */}
                    {depAlerts.length > 0 && (
                        <div className="space-y-2">
                            {depAlerts.map((alert, i) => (
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

                    {/* Document Number */}
                    <div className="space-y-2">
                        <Label>New {config?.numberLabel || 'Document Number'} <span className="text-muted-foreground font-normal">(optional — keeps old)</span></Label>
                        <Input
                            placeholder={document.documentNumber || config?.numberPlaceholder || ''}
                            value={documentNumber}
                            onChange={(e) => setDocumentNumber(e.target.value)}
                        />
                    </div>

                    {/* Issue Date */}
                    <div className="space-y-2">
                        <Label>New Issue Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>

                    {/* Expiry Date */}
                    {/* TODO: consider adding min={today} to prevent past dates in production */}
                    <div className="space-y-2">
                        <Label htmlFor="expiry">New {config?.expiryLabel || 'Expiry Date'} <span className="text-red-500">*</span></Label>
                        <Input
                            id="expiry"
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                        />
                    </div>

                    {/* File Upload (Optional) */}
                    <div className="space-y-2">
                        <Label>New File <span className="text-muted-foreground font-normal">(optional — keeps old file)</span></Label>
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
                    <Button onClick={handleSubmit} disabled={uploading || !expiryDate}>
                        {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        {uploading ? 'Renewing...' : 'Renew Document'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
