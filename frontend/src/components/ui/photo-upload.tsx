'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Camera, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface PhotoUploadProps {
    value?: string | null;
    onChange: (url: string | null) => void;
    name?: string;
    disabled?: boolean;
    size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
    sm: { container: 'w-16 h-16', icon: 'h-4 w-4', text: 'text-lg' },
    md: { container: 'w-24 h-24', icon: 'h-5 w-5', text: 'text-2xl' },
    lg: { container: 'w-32 h-32', icon: 'h-6 w-6', text: 'text-3xl' },
};

export function PhotoUpload({ value, onChange, name, disabled, size = 'md' }: PhotoUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const s = SIZES[size];

    const initials = name
        ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
        : '?';

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file (JPEG, PNG)');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be under 5MB');
            return;
        }

        setUploading(true);
        try {
            const result = await api.upload(file, 'photos');
            onChange(result.url);
        } catch {
            toast.error('Failed to upload photo');
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <div className="flex flex-col items-center gap-2">
            <div className={`${s.container} relative rounded-full overflow-hidden group`}>
                {value ? (
                    <img
                        src={value}
                        alt={name || 'Photo'}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                        <span className={s.text}>{initials}</span>
                    </div>
                )}

                {!disabled && !uploading && (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                    >
                        <Camera className={`${s.icon} text-white`} />
                    </button>
                )}

                {uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className={`${s.icon} text-white animate-spin`} />
                    </div>
                )}
            </div>

            {value && !disabled && (
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                >
                    <X className="h-3 w-3" /> Remove
                </button>
            )}

            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
            />
        </div>
    );
}
