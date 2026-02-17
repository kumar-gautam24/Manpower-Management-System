'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const COMMON_TRADES = [
    'Welder', 'Electrician', 'Plumber', 'Engineer', 'Technician',
    'Driver', 'Helper', 'Safety Officer', 'Carpenter', 'Painter',
    'Mason', 'Foreman', 'Supervisor',
];

interface TradeSelectProps {
    value: string;
    onChange: (value: string) => void;
    /** Start in custom mode (e.g. when editing a non-standard trade) */
    defaultCustom?: boolean;
}

export function TradeSelect({ value, onChange, defaultCustom = false }: TradeSelectProps) {
    const [custom, setCustom] = useState(defaultCustom);

    if (custom) {
        return (
            <div className="flex gap-2">
                <Input
                    placeholder="Enter custom trade..."
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => { setCustom(false); onChange(''); }}>
                    List
                </Button>
            </div>
        );
    }

    return (
        <div className="flex gap-2">
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue placeholder="Select trade..." />
                </SelectTrigger>
                <SelectContent>
                    {COMMON_TRADES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => setCustom(true)}>
                Custom
            </Button>
        </div>
    );
}

/** Re-export for consumers that need the list */
export { COMMON_TRADES };
