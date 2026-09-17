import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { OnboardingOfferPreview } from '../../types';

export const offerPreviewQueryOptions = () =>
  queryOptions({
    queryKey: ['onboarding', 'offer-preview'],
    queryFn: () =>
      apiClient.get<OnboardingOfferPreview>('onboarding/offer-preview'),
    staleTime: 60 * 1000,
  });

/**
 * The intro offer `accept-offer` WOULD create (read-only) — lets the
 * intro-offer slide show the actual first-visit price before the owner
 * commits.
 */
export const useOfferPreview = () => {
  const query = useQuery(offerPreviewQueryOptions());
  return {
    preview: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
};
