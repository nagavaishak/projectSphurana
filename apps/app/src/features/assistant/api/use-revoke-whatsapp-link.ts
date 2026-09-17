import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

import { whatsappLinkStatusQueryKey } from './use-whatsapp-link-status';

interface UseRevokeWhatsappLinkOptions {
  onSuccess?: () => void;
}

/** Disconnect a paired (or pending) WhatsApp link. */
export const useRevokeWhatsappLink = (
  options?: UseRevokeWhatsappLinkOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(
        assistantApiUrl(`whatsapp-link/${id}`),
        assistantRequestInit({ method: 'DELETE' })
      );
      if (!res.ok) throw new Error('Failed to disconnect WhatsApp');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappLinkStatusQueryKey });
      toast.success('WhatsApp disconnected');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect WhatsApp');
    },
  });

  return {
    revokeLink: mutation.mutate,
    isRevoking: mutation.isPending,
  };
};
