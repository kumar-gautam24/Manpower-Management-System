'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users, FileText, AlertTriangle, XCircle, Building2, Loader2, CheckCircle, TrendingUp,
  DollarSign,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getStatusConfig, docDisplayName } from '@/lib/constants';
import type { DashboardMetrics, ExpiryAlert, CompanySummary, ComplianceStats } from '@/types';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

// Chart color palette
const CHART_COLORS = {
  valid: '#22c55e',
  expiring: '#eab308',
  expired: '#ef4444',
  bar: '#6366f1',
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [compliance, setCompliance] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [metricsRes, alertsRes, companiesRes, complianceRes] = await Promise.all([
        api.dashboard.getMetrics(),
        api.dashboard.getExpiryAlerts().catch(() => ({ data: [], total: 0 })),
        api.dashboard.getCompanySummary().catch(() => ({ data: [] })),
        api.dashboard.getComplianceStats().catch(() => null),
      ]);
      setMetrics(metricsRes);
      setAlerts(alertsRes.data || []);
      setCompanies(companiesRes.data || []);
      if (complianceRes) setCompliance(complianceRes);
      setError(null);
    } catch {
      setError('Failed to load dashboard. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600">Connection Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={fetchData}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!metrics) return null;

  // Build chart data from metrics
  const donutData = [
    { name: 'Valid', value: metrics.activeDocuments, color: CHART_COLORS.valid },
    { name: 'Expiring', value: metrics.expiringSoon, color: CHART_COLORS.expiring },
    { name: 'Expired', value: metrics.expired, color: CHART_COLORS.expired },
  ].filter((d) => d.value > 0);

  const totalDocs = metrics.activeDocuments + metrics.expiringSoon + metrics.expired;

  const metricCards = [
    { label: 'Total Employees', value: metrics.totalEmployees, sub: 'Active workforce', icon: Users, href: '/employees' },
    { label: 'Active Documents', value: metrics.activeDocuments, sub: 'Valid documents', icon: FileText, href: '/employees?status=active' },
    { label: 'Expiring Soon', value: metrics.expiringSoon, sub: 'Within 30 days', icon: AlertTriangle, accent: metrics.expiringSoon > 0 ? 'text-yellow-600 dark:text-yellow-400' : '', href: '/employees?status=expiring' },
    { label: 'Expired', value: metrics.expired, sub: 'Requires renewal', icon: XCircle, accent: metrics.expired > 0 ? 'text-red-600 dark:text-red-400' : '', href: '/employees?status=expired' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Overview of your workforce and documents</p>
        </div>
        <Link href="/employees">
          <Button variant="outline" className="w-full sm:w-auto gap-2">
            <Users className="h-4 w-4" /> View Employees
          </Button>
        </Link>
      </div>

      {/* Metric Cards — 4 cards, clean neutral style. Only warning/error states get color. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                <card.icon className={`h-4 w-4 ${card.accent || 'text-muted-foreground'}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-semibold ${card.accent || 'text-foreground'}`}>{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Fine Exposure — show when fines > 0 OR docs in grace */}
      {compliance && (compliance.totalAccumulated > 0 || (compliance.documentsByStatus?.in_grace ?? 0) > 0) && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">Fine Exposure</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    {compliance.totalDailyFine > 0 && (
                      <span>{compliance.totalDailyFine.toFixed(0)} AED/day accumulating</span>
                    )}
                    {(compliance.documentsByStatus?.in_grace ?? 0) > 0 && (
                      <span className="text-orange-600 dark:text-orange-400">
                        {compliance.documentsByStatus.in_grace} in grace period
                      </span>
                    )}
                    {(compliance.documentsByStatus?.penalty_active ?? 0) > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        {compliance.documentsByStatus.penalty_active} with active fines
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {compliance.totalAccumulated > 0 && (
                <div className="text-2xl font-semibold text-red-600 dark:text-red-400">
                  {compliance.totalAccumulated.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} AED
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Status Donut Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" /> Document Status
            </CardTitle>
            <CardDescription>Distribution across all {totalDocs} documents</CardDescription>
          </CardHeader>
          <CardContent>
            {donutData.length > 0 ? (
              <div className="flex items-center justify-center gap-8">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {donutData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} strokeWidth={0} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3">
                  {donutData.map((item) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-muted-foreground">{item.name}</span>
                      <span className="text-sm font-bold text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <CheckCircle className="h-5 w-5 mr-2" /> No documents tracked yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Employees per Company Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> Employees by Company
            </CardTitle>
            <CardDescription>Workforce distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {companies.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={companies} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                  <Bar dataKey="employeeCount" fill={CHART_COLORS.bar} radius={[6, 6, 0, 0]} name="Employees" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Building2 className="h-5 w-5 mr-2" /> No companies yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Company Compliance Breakdown */}
      {compliance && compliance.companyBreakdown && compliance.companyBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> Company Compliance
            </CardTitle>
            <CardDescription>Per-company penalty and fine overview</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left font-medium px-6 py-2">Company</th>
                    <th className="text-center font-medium px-3 py-2">Employees</th>
                    <th className="text-center font-medium px-3 py-2">Penalties</th>
                    <th className="text-center font-medium px-3 py-2">Incomplete</th>
                    <th className="text-right font-medium px-3 py-2">Daily Exposure</th>
                    <th className="text-right font-medium px-6 py-2">Accumulated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {compliance.companyBreakdown.map((co) => (
                    <tr key={co.companyId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-2.5 font-medium text-foreground">{co.companyName}</td>
                      <td className="text-center px-3 py-2.5">{co.employeeCount}</td>
                      <td className="text-center px-3 py-2.5">
                        {co.penaltyCount > 0
                          ? <span className="text-red-600 dark:text-red-400 font-medium">{co.penaltyCount}</span>
                          : <span className="text-muted-foreground">0</span>
                        }
                      </td>
                      <td className="text-center px-3 py-2.5">
                        {co.incompleteCount > 0
                          ? <span className="text-yellow-600 dark:text-yellow-400 font-medium">{co.incompleteCount}</span>
                          : <span className="text-muted-foreground">0</span>
                        }
                      </td>
                      <td className="text-right px-3 py-2.5">
                        {co.dailyExposure > 0
                          ? <span className="text-red-600 dark:text-red-400">{co.dailyExposure.toFixed(0)} AED</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="text-right px-6 py-2.5">
                        {co.accumulatedFines > 0
                          ? <span className="text-red-600 dark:text-red-400 font-semibold">{co.accumulatedFines.toLocaleString('en', { maximumFractionDigits: 0 })} AED</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expiry Alerts — simple rows, no card-in-card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Critical Expiry Alerts</CardTitle>
          <CardDescription>
            {alerts.length > 0
              ? `${alerts.length} document${alerts.length !== 1 ? 's' : ''} expiring or expired`
              : 'No documents expiring within 30 days — all clear!'}
          </CardDescription>
        </CardHeader>
        {alerts.length > 0 && (
          <CardContent className="px-0">
            <div className="divide-y divide-border">
              {alerts.map((alert) => {
                const statusCfg = getStatusConfig(alert.status);
                return (
                  <Link key={alert.documentId} href={`/employees/${alert.employeeId}`}>
                    <div className="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground">{alert.employeeName}</span>
                          <Badge variant="outline" className={`text-[11px] ${statusCfg.badge}`}>
                            {statusCfg.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{alert.companyName}</span>
                          <span>·</span>
                          <span>{docDisplayName(alert.documentType)}</span>
                          <span className="hidden sm:inline">·</span>
                          <span className="hidden sm:inline">Expires: {alert.expiryDate}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 ml-4">
                        {alert.estimatedFine > 0 && (
                          <div className="text-right">
                            <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                              {alert.estimatedFine.toLocaleString('en', { maximumFractionDigits: 0 })} AED
                            </div>
                            <div className="text-[11px] text-muted-foreground">est. fine</div>
                          </div>
                        )}
                        <div className="text-center min-w-[48px]">
                          <div className={`text-lg font-bold ${alert.daysLeft < 0 ? 'text-red-600' : alert.daysLeft <= 7 ? 'text-orange-600' : 'text-yellow-600'}`}>
                            {Math.abs(alert.daysLeft)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {alert.daysLeft < 0 ? 'days late' : 'days left'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
