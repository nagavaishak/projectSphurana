'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { whatsappTemplateAtomSchema } from '@borradh-workspace/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import type { WhatsappTemplatesResponse } from './types';

const whatsappTemplatesKey = ['campaigns', 'whatsapp-templates'] as const;

// `{ templates, synced }` wrapper isn't a generated atom, so compose it here.
const whatsappTemplatesResponseSchema = z.object({
  templates: z.array(whatsappTemplateAtomSchema),
  synced: z.boolean(),
});

const fetchWhatsappTemplates = (refresh: boolean) =>
  apiClient.get<WhatsappTemplatesResponse>(
    `campaigns/whatsapp-templates${refresh ? '?refresh=true' : ''}`,
    { schema: whatsappTemplatesResponseSchema }
  );

export const whatsappTemplatesQueryOptions = () =>
  queryOptions({
    queryKey: whatsappTemplatesKey,
    // Reads the org's synced template cache (no Meta round-trip).
    queryFn: () => fetchWhatsappTemplates(false),
    staleTime: 60 * 1000,
  });

export const useWhatsappTemplates = (enabled = true) => {
  const query = useQuery({ ...whatsappTemplatesQueryOptions(), enabled });
  return {
    templates: query.data?.templates ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

/** Re-sync the template list from Meta (`?refresh=true`) and update the cache. */
export const useRefreshWhatsappTemplates = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => fetchWhatsappTemplates(true),
    onSuccess: (data) => {
      qc.setQueryData(whatsappTemplatesKey, data);
      qc.invalidateQueries({ queryKey: whatsappTemplatesKey });
      toast.success('Templates refreshed from Meta');
    },
    onError: (e: Error) =>
      toast.error(e.message || 'Could not refresh templates'),
  });
  return {
    refreshTemplates: mutation.mutate,
    isRefreshing: mutation.isPending,
  };
};
