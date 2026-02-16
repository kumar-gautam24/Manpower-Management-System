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

interface RenewDocumentDialogProps {
    document: Document | DocumentWithCompliance; // The document being renewed
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function RenewDocumentDialog({ document, open, onOpenChange, onSuccess }: RenewDocumentDialogProps) {
    const [expiryDate, setExpiryDate] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setExpiryDate('');
        setFile(null);
    };

    const fileIcon = file?.type.startsWith('image/') ? Image : FileText;
    const FileIcon = fileIcon;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Renew Document: {document.documentType}</DialogTitle>
                    <DialogDescription>
                        Renewing sets this document as the active version. The old version will be archived.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Expiry Date */}
                    <div className="space-y-2">
                        <Label htmlFor="expiry">New Expiry Date <span className="text-red-500">*</span></Label>
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
