'use client';

import { getStatusConfig, docDisplayName } from '@/lib/constants';
import type { DocumentWithCompliance } from '@/types';

interface DocumentTimelineProps {
    documents: DocumentWithCompliance[];
}

/** Format a date string to "10 Feb 2026" */
function fmtDate(d?: string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Pure CSS horizontal bar chart showing each document's remaining time */
export function DocumentTimeline({ documents }: DocumentTimelineProps) {
    // Only show docs that have an expiry date
    const docsWithExpiry = documents
        .filter(d => d.expiryDate && d.status !== 'incomplete')
        .sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));

    if (docsWithExpiry.length === 0) return null;

    // Normalize bar widths: max is either the longest remaining days or 365, whichever is larger
    const maxDays = Math.max(
        365,
        ...docsWithExpiry.map(d => Math.max(d.daysRemaining ?? 0, 0))
    );

    const statusBarColor: Record<string, string> = {
        valid: 'bg-green-500',
        expiring_soon: 'bg-yellow-500',
        in_grace: 'bg-orange-500',
        penalty_active: 'bg-red-500',
        incomplete: 'bg-gray-400',
    };

    return (
        <div className="space-y-2.5">
            {docsWithExpiry.map((doc) => {
                const days = Math.max(doc.daysRemaining ?? 0, 0);
                const pct = Math.max(Math.round((days / maxDays) * 100), 2); // min 2% for visibility
                const barColor = statusBarColor[doc.status] || 'bg-gray-400';
                const statusCfg = getStatusConfig(doc.status);
                const name = doc.displayName || docDisplayName(doc.documentType, doc.metadata);

                return (
                    <div key={doc.id} className="group">
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium text-foreground truncate mr-2">{name}</span>
                            <span className={`whitespace-nowrap ${statusCfg.text}`}>
                                {doc.daysRemaining != null && doc.daysRemaining < 0
                                    ? `${Math.abs(doc.daysRemaining)}d overdue`
                                    : doc.daysRemaining != null
                                        ? `${doc.daysRemaining}d left`
                                        : ''
                                }
                                {' · '}
                                {fmtDate(doc.expiryDate)}
                            </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: doc.daysRemaining != null && doc.daysRemaining < 0 ? '100%' : `${pct}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
