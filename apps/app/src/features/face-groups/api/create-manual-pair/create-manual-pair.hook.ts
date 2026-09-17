import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CreateManualPairInput {
  batchId: string;
  beforeAssetId: string;
  afterAssetId: string;
  clientName?: string;
}

export const useCreateManualPair = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateManualPairInput) =>
      apiClient.post('face-groups/manual-pair', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['face-groups'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Manual pair created');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create manual pair');
    },
  });

  return {
    createManualPair: mutation.mutate,
    createManualPairAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
