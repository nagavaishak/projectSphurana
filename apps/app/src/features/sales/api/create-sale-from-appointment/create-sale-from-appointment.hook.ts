import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCreateSaleFromAppointmentOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

/**
 * Seed a sale from an appointment: the server binds the sale to the
 * appointment's client and prices the line from the booked services' snapshot
 * prices, so checkout opens pre-filled instead of at €0 with no client.
 */
export const useCreateSaleFromAppointment = (
  options?: UseCreateSaleFromAppointmentOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: { appointmentId: string }) =>
      apiClient.post<SaleWithRelations>('sales/from-appointment', input, {
        schema: saleWithRelationsSchema,
      }),
    onSuccess: (sale) => {
      invalidateKeys(queryClient, queryKeys.sales.list());
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start sale');
      options?.onError?.(error);
    },
  });

  return {
    createSaleFromAppointment: mutation.mutate,
    createSaleFromAppointmentAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
