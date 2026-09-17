import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { Sale } from '@borradh-workspace/api-client/types';
import { saleSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useUpdateShopFulfilment = (saleId: string) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: 'ready' | 'collected') =>
      apiClient.post<Sale>(
        `sales/${saleId}/fulfilment/${status}`,
        {},
        { schema: saleSchema }
      ),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all() });
      toast.success(
        status === 'ready' ? 'Order marked ready' : 'Order marked collected'
      );
    },
    onError: (error: Error) =>
      toast.error(error.message || 'Could not update order'),
  });
  return { updateFulfilment: mutation.mutate, isUpdating: mutation.isPending };
};
