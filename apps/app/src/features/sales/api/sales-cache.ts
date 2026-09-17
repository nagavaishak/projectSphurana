import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Sync React Query caches after a sale mutation returns the updated sale.
 * Writes the fresh sale into its detail cache and invalidates the sales list
 * and daily summary so aggregates stay current.
 */
export function syncSaleCaches(
  queryClient: QueryClient,
  sale: Pick<SaleWithRelations, 'id'> & Partial<SaleWithRelations>
): void {
  if (sale.id) {
    queryClient.setQueryData(['sales', 'detail', sale.id], sale);
  }
  queryClient.invalidateQueries({ queryKey: ['sales', 'list'] });
  queryClient.invalidateQueries({ queryKey: ['sales', 'daily-summary'] });
}
