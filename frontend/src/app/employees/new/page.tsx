'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import type { Company, CreateEmployeeRequest } from '@/types';
import { toast } from 'sonner';
import { TradeSelect } from '@/components/trade-select';

export default function AddEmployeePage() {
    const router = useRouter();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState<CreateEmployeeRequest>({
        companyId: '',
        name: '',
        trade: '',
        mobile: '',
        joiningDate: new Date().toISOString().split('T')[0],
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const fetchCompanies = useCallback(async () => {
        try {
            const res = await api.companies.list();
            setCompanies(res.data || []);
            if (res.data?.length === 1) {
                setForm((f) => ({ ...f, companyId: res.data[0].id }));
            }
        } catch (err) {
            console.error('Failed to fetch companies:', err);
        }
    }, []);

    useEffect(() => {
        fetchCompanies();
    }, [fetchCompanies]);

    const validate = (): boolean => {
        const errs: Record<string, string> = {};
        if (form.name.length < 2) errs.name = 'Name must be at least 2 characters';
        if (!form.trade) errs.trade = 'Trade is required';
        if (!form.companyId) errs.companyId = 'Company is required';
        if (!form.mobile) {
            errs.mobile = 'Mobile number is required';
        } else if (!/^\+?[0-9]{7,15}$/.test(form.mobile.replace(/[\s-]/g, ''))) {
            errs.mobile = 'Enter a valid mobile number (e.g. +971501234567)';
        }
        if (!form.joiningDate) errs.joiningDate = 'Joining date is required';
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        try {
            setSubmitting(true);
            const res = await api.employees.create(form);
            const empId = res.data.id;
            toast.success('Employee created — mandatory document slots ready!', {
                description: 'Fill in the mandatory documents to start compliance tracking.',
                duration: 8000,
                action: {
                    label: 'Fill documents now →',
                    onClick: () => router.push(`/employees/${empId}`),
                },
            });
            router.push(`/employees/${empId}`);
        } catch (err) {
            console.error('Failed to create employee:', err);
            toast.error('Failed to create employee');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <Link href="/employees" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to employees
            </Link>

            <Card>
                <CardHeader>
                    <CardTitle>Add New Employee</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Name */}
                        <div className="space-y-2">
                            <Label htmlFor="name">Full Name *</Label>
                            <Input
                                id="name"
                                placeholder="e.g. John Doe"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />
                            {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
                        </div>

                        {/* Trade */}
                        <div className="space-y-2">
                            <Label>Trade / Job Role *</Label>
                            <TradeSelect
                                value={form.trade}
                                onChange={(v) => setForm({ ...form, trade: v })}
                            />
                            {errors.trade && <p className="text-sm text-red-500">{errors.trade}</p>}
                        </div>

                        {/* Company */}
                        <div className="space-y-2">
                            <Label>Company *</Label>
                            <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select company..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {companies.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {errors.companyId && <p className="text-sm text-red-500">{errors.companyId}</p>}
                        </div>

                        {/* Mobile */}
                        <div className="space-y-2">
                            <Label htmlFor="mobile">Mobile Number *</Label>
                            <Input
                                id="mobile"
                                placeholder="+971501234567"
                                value={form.mobile}
                                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                            />
                            {errors.mobile && <p className="text-sm text-red-500">{errors.mobile}</p>}
                        </div>

                        {/* Joining Date */}
                        <div className="space-y-2">
                            <Label htmlFor="joiningDate">Joining Date *</Label>
                            <Input
                                id="joiningDate"
                                type="date"
                                value={form.joiningDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
                            />
                            {errors.joiningDate && <p className="text-sm text-red-500">{errors.joiningDate}</p>}
                        </div>

                        {/* ── Optional Profile Details ────────────────── */}
                        <div className="border-t border-border pt-5 mt-4">
                            <p className="text-sm font-medium text-foreground mb-4">Optional Profile Details</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Gender</Label>
                                    <Select value={form.gender || ''} onValueChange={(v) => setForm({ ...form, gender: v })}>
                                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">Male</SelectItem>
                                            <SelectItem value="female">Female</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="dob">Date of Birth</Label>
                                    <Input id="dob" type="date" value={form.dateOfBirth || ''}
                                        onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="nationality">Nationality</Label>
                                    <Input id="nationality" placeholder="e.g. Indian" value={form.nationality || ''}
                                        onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="passport">Passport Number</Label>
                                    <Input id="passport" placeholder="e.g. A12345678" value={form.passportNumber || ''}
                                        onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="nativeLoc">Native Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                    <Input id="nativeLoc" placeholder="e.g. Kerala, India" value={form.nativeLocation || ''}
                                        onChange={(e) => setForm({ ...form, nativeLocation: e.target.value })} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="currentLoc">Current Location</Label>
                                    <Input id="currentLoc" placeholder="e.g. Dubai, UAE" value={form.currentLocation || ''}
                                        onChange={(e) => setForm({ ...form, currentLocation: e.target.value })} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="salary">Salary ({companies.find(c => c.id === form.companyId)?.currency || 'AED'}/month) <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                    <Input id="salary" type="number" step="0.01" placeholder="e.g. 3500" value={form.salary ?? ''}
                                        onChange={(e) => setForm({ ...form, salary: e.target.value ? parseFloat(e.target.value) : undefined })} />
                                </div>

                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select value={form.status || 'active'} onValueChange={(v) => setForm({ ...form, status: v })}>
                                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                            <SelectItem value="on_leave">On Leave</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        {/* Submit */}
                        <div className="flex justify-end gap-3 pt-2">
                            <Button type="submit" disabled={submitting}>
                                {submitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" /> Create Employee
                                    </>
                                )}
                            </Button>
                            <Link href="/employees">
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
