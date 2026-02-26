'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Company } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Users, Loader2 } from 'lucide-react';

interface CompanyEmployee {
    id: string;
    name: string;
    trade: string;
    status: string;
    photoUrl?: string | null;
    nationality?: string | null;
}

const statusColors: Record<string, string> = {
    active: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
    on_leave: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400',
    inactive: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400',
};

export default function CompanyDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const [company, setCompany] = useState<Company | null>(null);
    const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        api.companies.getById(id)
            .then(res => {
                setCompany(res.data.company);
                setEmployees(res.data.employees);
            })
            .catch(() => router.push('/companies'))
            .finally(() => setLoading(false));
    }, [id, router]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!company) return null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push('/companies')}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline">{company.currency || 'AED'}</Badge>
                            {company.regulatoryAuthority && <Badge variant="outline">{company.regulatoryAuthority}</Badge>}
                            {company.mohreCategory && <Badge variant="outline">Category {company.mohreCategory}</Badge>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Company Details */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Company Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {company.tradeLicenseNumber && (
                            <div>
                                <p className="text-muted-foreground">Trade License</p>
                                <p className="font-medium">{company.tradeLicenseNumber}</p>
                            </div>
                        )}
                        {company.establishmentCardNumber && (
                            <div>
                                <p className="text-muted-foreground">Establishment Card</p>
                                <p className="font-medium">{company.establishmentCardNumber}</p>
                            </div>
                        )}
                        {company.mohreCategory && (
                            <div>
                                <p className="text-muted-foreground">MoHRE Category</p>
                                <p className="font-medium">Category {company.mohreCategory}</p>
                            </div>
                        )}
                        {company.regulatoryAuthority && (
                            <div>
                                <p className="text-muted-foreground">Regulatory Authority</p>
                                <p className="font-medium">{company.regulatoryAuthority}</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Employee List */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Employees ({employees.length})
                        </CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    {employees.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">No employees in this company yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Trade</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Nationality</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {employees.map(emp => (
                                        <tr key={emp.id} className="border-b border-border/50 hover:bg-accent/30">
                                            <td className="py-3 px-4">
                                                <Link
                                                    href={`/employees/${emp.id}`}
                                                    className="font-medium text-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                                >
                                                    {emp.name}
                                                </Link>
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">{emp.trade}</td>
                                            <td className="py-3 px-4 text-muted-foreground">{emp.nationality || '—'}</td>
                                            <td className="py-3 px-4">
                                                <Badge className={statusColors[emp.status] || statusColors.active} variant="outline">
                                                    {emp.status.replace(/_/g, ' ')}
                                                </Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
