'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import type {
  EnsureWhatsappTemplateResponse,
  EnsureWhatsappTemplateStatus,
} from './types';

// `{ status }` isn't a generated contract atom, so compose its shape here.
const ensureWhatsappTemplateResponseSchema = z.object({
  status: z.enum([
    'approved',
    'pending',
    'rejected',
    'paused',
    'disabled',
    'created',
    'missing_account',
  ]),
});

/**
 * Auto-provision the canonical `borradh_campaign_message` template on the org's
 * WABA (idempotent). Returns its status so the composer can show the first-run
 * "WhatsApp will start sending once Meta approves your template (up to 24h)"
 * notice when the template was just `created`. Email is unaffected either way.
 */
export const useEnsureWhatsappTemplate = (options?: {
  onSuccess?: (status: EnsureWhatsappTemplateStatus) => void;
  /** Suppress this hook's own toasts — used when a caller owns them. */
  silent?: boolean;
}) => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<EnsureWhatsappTemplateResponse>(
        'campaigns/whatsapp-templates/ensure',
        undefined,
        { schema: ensureWhatsappTemplateResponseSchema }
      ),
    onSuccess: (data) => {
      // A freshly created template shows up in the list (as `pending`).
      if (data.status === 'created') {
        qc.invalidateQueries({
          queryKey: queryKeys.campaigns.whatsappTemplates(),
        });
        if (!options?.silent) {
          toast.success(
            'WhatsApp template submitted — Meta approval can take up to 24 hours'
          );
        }
      }
      options?.onSuccess?.(data.status);
    },
    onError: (e: Error) => {
      if (!options?.silent) {
        toast.error(e.message || 'Could not set up WhatsApp messaging');
      }
    },
  });
  return {
    ensureTemplate: mutation.mutate,
    ensureTemplateAsync: mutation.mutateAsync,
    status: mutation.data?.status ?? null,
    isEnsuring: mutation.isPending,
  };
};
