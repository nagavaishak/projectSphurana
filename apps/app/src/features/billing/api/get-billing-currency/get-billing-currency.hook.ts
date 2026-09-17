import { apiClient } from '@borradh-workspace/api-client';
import { billingCurrencyResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { SupportedCurrency } from '../types';

interface BillingCurrencyResponse {
  currency: SupportedCurrency | null;
}

export const getBillingCurrencyQueryOptions = () =>
  queryOptions({
    queryKey: ['billing', 'currency'],
    queryFn: () =>
      apiClient.get<BillingCurrencyResponse>('billing/currency', {
        schema: billingCurrencyResponseSchema,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

/**
 * The currency the org's Stripe customer is already locked to (null when none).
 * The billing page should prefer this over browser-detected currency so the
 * displayed price matches what Stripe will charge.
 */
export const useGetBillingCurrency = () => {
  const query = useQuery(getBillingCurrencyQueryOptions());

  return {
    currency: query.data?.currency ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
};
