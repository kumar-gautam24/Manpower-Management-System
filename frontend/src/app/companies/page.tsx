'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Building2, Plus, Pencil, Trash2, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useUser } from '@/hooks/use-user';

const COMMON_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR'];

interface CompanyWithCount {
    id: string;
    name: string;
    currency: string;
    tradeLicenseNumber?: string | null;
    establishmentCardNumber?: string | null;
    mohreCategory?: string | null;
    regulatoryAuthority?: string | null;
    employeeCount: number;
    createdAt: string;
    updatedAt: string;
}

export default function CompaniesPage() {
    const [companies, setCompanies] = useState<CompanyWithCount[]>([]);
    const [loading, setLoading] = useState(true);
    const { isAdmin } = useUser();

    // Add/Edit dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [companyName, setCompanyName] = useState('');
    const [companyCurrency, setCompanyCurrency] = useState('AED');
    const [tradeLicense, setTradeLicense] = useState('');
    const [establishmentCard, setEstablishmentCard] = useState('');
    const [mohreCategory, setMohreCategory] = useState('');
    const [regulatoryAuthority, setRegulatoryAuthority] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchCompanies = useCallback(async () => {
        try {
            const res = await api.companies.list();
            setCompanies(res.data as unknown as CompanyWithCount[]);
        } catch {
            toast.error('Failed to load companies');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

    const handleSave = async () => {
        if (!companyName.trim()) return;
        setSaving(true);

        try {
            if (editingId) {
                await api.companies.update(editingId, {
                    name: companyName.trim(),
                    currency: companyCurrency,
                    tradeLicenseNumber: tradeLicense || undefined,
                    establishmentCardNumber: establishmentCard || undefined,
                    mohreCategory: mohreCategory || undefined,
                    regulatoryAuthority: regulatoryAuthority || undefined,
                });
                toast.success('Company updated');
            } else {
                await api.companies.create({
                    name: companyName.trim(),
                    currency: companyCurrency,
                    tradeLicenseNumber: tradeLicense || undefined,
                    establishmentCardNumber: establishmentCard || undefined,
                    mohreCategory: mohreCategory || undefined,
                    regulatoryAuthority: regulatoryAuthority || undefined,
                });
                toast.success('Company created');
            }

            setDialogOpen(false);
            resetDialog();
            fetchCompanies();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.companies.delete(id);
            toast.success('Company deleted');
            fetchCompanies();
        } catch {
            toast.error('Failed to delete company');
        }
    };

    const resetDialog = () => {
        setCompanyName('');
        setCompanyCurrency('AED');
        setTradeLicense('');
        setEstablishmentCard('');
        setMohreCategory('');
        setRegulatoryAuthority('');
        setEditingId(null);
    };

    const openEdit = (company: CompanyWithCount) => {
        setEditingId(company.id);
        setCompanyName(company.name);
        setCompanyCurrency(company.currency || 'AED');
        setTradeLicense(company.tradeLicenseNumber || '');
        setEstablishmentCard(company.establishmentCardNumber || '');
        setMohreCategory(company.mohreCategory || '');
        setRegulatoryAuthority(company.regulatoryAuthority || '');
        setDialogOpen(true);
    };

    const openAdd = () => {
        resetDialog();
        setDialogOpen(true);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Companies</h1>
                    <p className="text-muted-foreground mt-1">
                        {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} registered
                    </p>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    {isAdmin && (
                        <DialogTrigger asChild>
                            <Button onClick={openAdd} className="gap-2">
                                <Plus className="h-4 w-4" /> Add Company
                            </Button>
                        </DialogTrigger>
                    )}
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingId ? 'Edit Company' : 'Add Company'}</DialogTitle>
                            <DialogDescription>
                                {editingId ? 'Update the company details.' : 'Enter the details for the new company.'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="company-name">Company Name</Label>
                                <Input
                                    id="company-name"
                                    placeholder="ABC Construction Co."
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Currency</Label>
                                <Select value={companyCurrency} onValueChange={setCompanyCurrency}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select currency..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COMMON_CURRENCIES.map((c) => (
                                            <SelectItem key={c} value={c}>{c}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Regulatory Fields */}
                            <div className="border-t pt-4 mt-2">
                                <p className="text-sm font-medium text-muted-foreground mb-3">Regulatory Information (Optional)</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="trade-license" className="text-xs">Trade License No.</Label>
                                        <Input
                                            id="trade-license"
                                            placeholder="e.g. 12345"
                                            value={tradeLicense}
                                            onChange={(e) => setTradeLicense(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="establishment-card" className="text-xs">Establishment Card No.</Label>
                                        <Input
                                            id="establishment-card"
                                            placeholder="e.g. EC-67890"
                                            value={establishmentCard}
                                            onChange={(e) => setEstablishmentCard(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="mohre-category" className="text-xs">MoHRE Category</Label>
                                        <Select value={mohreCategory || 'none'} onValueChange={(v) => setMohreCategory(v === 'none' ? '' : v)}>
                                            <SelectTrigger id="mohre-category">
                                                <SelectValue placeholder="Select..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Not set</SelectItem>
                                                <SelectItem value="1">Category 1</SelectItem>
                                                <SelectItem value="2">Category 2</SelectItem>
                                                <SelectItem value="3">Category 3</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="regulatory-authority" className="text-xs">Regulatory Authority</Label>
                                        <Select value={regulatoryAuthority || 'none'} onValueChange={(v) => setRegulatoryAuthority(v === 'none' ? '' : v)}>
                                            <SelectTrigger id="regulatory-authority">
                                                <SelectValue placeholder="Select..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Not set</SelectItem>
                                                <SelectItem value="MOHRE">MOHRE</SelectItem>
                                                <SelectItem value="JAFZA">JAFZA</SelectItem>
                                                <SelectItem value="DMCC">DMCC</SelectItem>
                                                <SelectItem value="DIFC">DIFC</SelectItem>
                                                <SelectItem value="DAFZA">DAFZA</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleSave} disabled={saving || !companyName.trim()}>
                                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                {editingId ? 'Save Changes' : 'Create Company'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Company Cards Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {companies.map((company) => (
                    <Card key={company.id} className="group hover:shadow-md transition-shadow border-border/60">
                        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
                                    <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-base font-semibold">{company.name}</CardTitle>
                                    <Badge variant="outline" className="mt-1 text-xs">{company.currency || 'AED'}</Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Users className="h-4 w-4" />
                                    <span>{company.employeeCount} employee{company.employeeCount !== 1 ? 's' : ''}</span>
                                </div>

                                {isAdmin && (
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(company)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>

                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 dark:text-red-400">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete {company.name}?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This will also delete all {company.employeeCount} employees
                                                        and their documents. This action cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(company.id)}
                                                        className="bg-red-600 hover:bg-red-700"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Empty state */}
            {companies.length === 0 && (
                <div className="text-center py-16 space-y-3">
                    <Building2 className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                    <h2 className="text-lg font-semibold text-foreground">No companies yet</h2>
                    <p className="text-muted-foreground">Add your first company to start managing employees.</p>
                    {isAdmin && (
                        <Button onClick={openAdd} className="gap-2 mt-2">
                            <Plus className="h-4 w-4" /> Add Company
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
