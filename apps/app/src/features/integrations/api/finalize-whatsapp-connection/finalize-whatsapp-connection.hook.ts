import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface FinalizeWhatsAppConnectionInput {
  code: string;
  wabaId: string;
}

export interface FinalizeWhatsAppConnectionResponse {
  accounts: Array<{ id: string; phoneNumberId: string; wabaId: string }>;
}

interface UseFinalizeWhatsAppConnectionOptions {
  onSuccess?: (data: FinalizeWhatsAppConnectionResponse) => void;
  onError?: (error: Error) => void;
}

export const useFinalizeWhatsAppConnection = (
  options?: UseFinalizeWhatsAppConnectionOptions
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: FinalizeWhatsAppConnectionInput) =>
      apiClient.post<FinalizeWhatsAppConnectionResponse>(
        'integrations/whatsapp/finalize',
        input
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'whatsapp'] });
      toast.success('WhatsApp connected');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to finalize WhatsApp connection');
      options?.onError?.(error);
    },
  });

  return {
    finalize: mutation.mutate,
    finalizeAsync: mutation.mutateAsync,
    isFinalizing: mutation.isPending,
  };
};
