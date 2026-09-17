import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetGoogleReviewLinkResponse } from '../../types';

export const getGoogleReviewLinkQueryOptions = (accountId: string) =>
  queryOptions({
    queryKey: ['integrations', 'google-my-business', 'review-link', accountId],
    queryFn: () =>
      apiClient.get<GetGoogleReviewLinkResponse>(
        `integrations/google-my-business/accounts/${accountId}/review-link`
      ),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

type UseGetGoogleReviewLinkOptions = {
  accountId: string;
  queryConfig?: QueryConfig<typeof getGoogleReviewLinkQueryOptions>;
};

export const useGetGoogleReviewLink = ({
  accountId,
  queryConfig,
}: UseGetGoogleReviewLinkOptions) => {
  const query = useQuery({
    ...getGoogleReviewLinkQueryOptions(accountId),
    ...queryConfig,
  });

  return {
    reviewLink: query.data?.reviewLink ?? null,
    locationName: query.data?.locationName ?? null,
    placeId: query.data?.placeId ?? null,
    averageRating: query.data?.averageRating ?? null,
    totalReviews: query.data?.totalReviews ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
