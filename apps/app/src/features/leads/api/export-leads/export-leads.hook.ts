import type { ExportLeadsFilters } from '@borradh-workspace/api-client/types';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';

interface UseExportLeadsOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useExportLeads = (options?: UseExportLeadsOptions) => {
  const mutation = useMutation({
    mutationFn: async (filters?: ExportLeadsFilters) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.source) params.set('source', filters.source);
      if (filters?.search) params.set('search', filters.search);
      const qs = params.toString();

      const token = getAuthToken();
      const response = await fetch(
        resolveApiUrl(`leads/export${qs ? `?${qs}` : ''}`),
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );

      if (!response.ok) {
        throw new Error('Failed to export clients');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast.success('Clients exported successfully');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to export clients');
      options?.onError?.(error);
    },
  });

  return {
    exportLeads: mutation.mutate,
    isExporting: mutation.isPending,
  };
};
