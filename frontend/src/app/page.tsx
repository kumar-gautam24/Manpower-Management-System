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
import type { DashboardMetrics, ExpiryAlert, CompanySummary, ComplianceStats } from '@/types';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

// Chart color palette — consistent across light and dark mode
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
            <Button onClick={() => window.location.reload()}>Retry</Button>
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

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Overview of your workforce and documents</p>
        </div>
        <Link href="/employees">
          <Button className="w-full sm:w-auto gap-2">
            <Users className="h-4 w-4" /> View Employees
          </Button>
        </Link>
      </div>

      {/* Metric Cards — clickable for detail */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Employees', value: metrics.totalEmployees, sub: 'Active workforce', icon: Users, border: 'border-l-blue-500', iconColor: 'text-blue-500', valueColor: '', href: '/employees' },
          { label: 'Active Documents', value: metrics.activeDocuments, sub: 'Valid documents', icon: FileText, border: 'border-l-green-500', iconColor: 'text-green-500', valueColor: '', href: '/employees?status=active' },
          { label: 'Expiring Soon', value: metrics.expiringSoon, sub: 'Within 30 days', icon: AlertTriangle, border: 'border-l-yellow-500', iconColor: 'text-yellow-500', valueColor: 'text-yellow-700 dark:text-yellow-400', href: '/employees?status=expiring' },
          { label: 'Expired', value: metrics.expired, sub: 'Requires renewal', icon: XCircle, border: 'border-l-red-500', iconColor: 'text-red-500', valueColor: 'text-red-700 dark:text-red-400', href: '/employees?status=expired' },
          {
            label: 'Fine Exposure',
            value: compliance ? `${compliance.totalAccumulated.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '0',
            sub: compliance ? `${compliance.totalDailyFine.toFixed(0)} AED/day` : 'No fines',
            icon: DollarSign,
            border: 'border-l-purple-500',
            iconColor: 'text-purple-500',
            valueColor: 'text-purple-700 dark:text-purple-400',
            href: '/employees?status=expired',
          },
        ].map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className={`border-l-4 ${card.border} hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer border-border/60`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                <card.icon className={`h-5 w-5 ${card.iconColor}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${card.valueColor || 'text-foreground'}`}>{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Status Donut Chart */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Document Status
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
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Employees by Company
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

      {/* Expiry Alerts Table */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Critical Expiry Alerts</CardTitle>
          <CardDescription>
            {alerts.length > 0
              ? `${alerts.length} document${alerts.length !== 1 ? 's' : ''} expiring or expired`
              : 'No documents expiring within 30 days — all clear!'}
          </CardDescription>
        </CardHeader>
        {alerts.length > 0 && (
          <CardContent className="px-4 sm:px-6">
            <div className="space-y-3">
              {alerts.map((alert) => (
                <Link key={alert.documentId} href={`/employees/${alert.employeeId}`}>
                  <div className="flex items-center justify-between p-4 rounded-lg border border-border/60 hover:shadow-md transition-shadow cursor-pointer mb-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <h3 className="font-semibold text-foreground">{alert.employeeName}</h3>
                        <Badge
                          variant="outline"
                          className={`w-fit ${alert.status === 'expired'
                            ? 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800'
                            : alert.status === 'urgent'
                              ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                              : 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
                            }`}
                        >
                          {alert.status === 'expired' ? 'Expired' : alert.status === 'urgent' ? 'Urgent' : 'Warning'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {alert.companyName}</span>
                        <span>•</span>
                        <span className="font-medium">{alert.documentType}</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="hidden sm:inline text-xs">Expires: {alert.expiryDate}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 ml-4">
                      {alert.estimatedFine > 0 && (
                        <div className="text-center">
                          <div className="text-sm font-bold text-purple-600 dark:text-purple-400">
                            {alert.estimatedFine.toLocaleString('en', { maximumFractionDigits: 0 })} AED
                          </div>
                          <div className="text-xs text-muted-foreground">est. fine</div>
                        </div>
                      )}
                      <div className="text-center">
                        <div className={`text-2xl font-bold ${alert.daysLeft < 0 ? 'text-red-600' : alert.daysLeft <= 7 ? 'text-orange-600' : 'text-yellow-600'}`}>
                          {Math.abs(alert.daysLeft)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {alert.daysLeft < 0 ? 'days late' : 'days left'}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
