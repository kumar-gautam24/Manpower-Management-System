import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDocumentType } from '@/types';

/**
 * Fetches document types from the DB via React Query.
 * Cached for 5 minutes so forms don't refetch on every render.
 */
export function useDocumentTypes() {
    const { data: types = [], isLoading: loading } = useQuery<AdminDocumentType[]>({
        queryKey: ['document-types'],
        queryFn: async () => {
            const res = await api.documentTypes.list();
            return res.data;
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    });

    return { types, loading };
}

/** Look up a single document type config by its slug. */
export function useDocumentTypeConfig(docType: string) {
    const { types, loading } = useDocumentTypes();
    const config = types.find(t => t.docType === docType);
    return { config, loading };
}
