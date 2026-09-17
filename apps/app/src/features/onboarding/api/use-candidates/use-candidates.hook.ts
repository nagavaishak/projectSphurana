import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { OnboardingCandidatesResponse } from '../../types';

const isTerminal = (status: string) =>
  status === 'ready' || status === 'failed';

export const getOnboardingCandidatesQueryOptions = () =>
  queryOptions({
    queryKey: ['onboarding', 'candidates'],
    queryFn: () =>
      apiClient.get<OnboardingCandidatesResponse>('onboarding/candidates'),
    staleTime: 0,
    // Poll while any candidate is still rendering so the ad/video picker
    // grids flip from shimmer to preview without a manual refresh. Also poll
    // while the lists are still EMPTY — accept-offer fire-and-forgets the
    // generators, so rows appear shortly after. Stop once every candidate is
    // terminal (ready/failed).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const all = [...data.adCandidates, ...data.videoCandidates];
      if (all.length === 0) return 3000;
      const anyRendering = all.some((c) => !isTerminal(c.status));
      return anyRendering ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });

type UseCandidatesOptions = {
  queryConfig?: QueryConfig<typeof getOnboardingCandidatesQueryOptions>;
};

/** Render-status poll for the ad-picker / video-picker slides. */
export const useCandidates = ({ queryConfig }: UseCandidatesOptions = {}) => {
  const query = useQuery({
    ...getOnboardingCandidatesQueryOptions(),
    ...queryConfig,
  });

  return {
    adCandidates: query.data?.adCandidates ?? [],
    videoCandidates: query.data?.videoCandidates ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
