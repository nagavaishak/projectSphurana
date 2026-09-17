import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { OnboardingSession } from '../../types';

export const getOnboardingSessionQueryOptions = () =>
  queryOptions({
    queryKey: ['onboarding', 'session'],
    // Null until the user's first real interaction — GET is a non-creating
    // peek (legacy users must not get sessions minted by visiting).
    queryFn: () =>
      apiClient.get<OnboardingSession | null>('onboarding/session'),
    staleTime: 30 * 1000,
  });

type UseOnboardingSessionOptions = {
  queryConfig?: QueryConfig<typeof getOnboardingSessionQueryOptions>;
};

/** Current user's onboarding session (lazily created server-side). */
export const useOnboardingSession = ({
  queryConfig,
}: UseOnboardingSessionOptions = {}) => {
  const query = useQuery({
    ...getOnboardingSessionQueryOptions(),
    ...queryConfig,
  });

  return {
    session: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
