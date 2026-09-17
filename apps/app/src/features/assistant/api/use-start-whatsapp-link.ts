import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

import { whatsappLinkStatusQueryKey } from './use-whatsapp-link-status';

export interface StartWhatsappLinkResult {
  id: string;
  code: string;
  waLink: string;
  codeExpiresAt: string;
}

interface UseStartWhatsappLinkOptions {
  onSuccess?: (result: StartWhatsappLinkResult) => void;
}

/**
 * Begin pairing: creates a pending link + single-use code and returns the
 * `wa.me` deep link the owner taps (or the code they paste manually).
 */
export const useStartWhatsappLink = (options?: UseStartWhatsappLinkOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<StartWhatsappLinkResult> => {
      const res = await fetch(
        assistantApiUrl('whatsapp-link/start'),
        assistantRequestInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      );
      if (!res.ok) throw new Error('Failed to start WhatsApp pairing');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: whatsappLinkStatusQueryKey });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start WhatsApp pairing');
    },
  });

  return {
    startLink: mutation.mutate,
    startLinkAsync: mutation.mutateAsync,
    isStarting: mutation.isPending,
    data: mutation.data ?? null,
  };
};
