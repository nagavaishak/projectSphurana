import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { socialPostSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { SocialPost } from '../../types';

export const getSocialPostQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['social-posts', id],
    queryFn: async () => {
      return apiClient.get<SocialPost>(`social-posts/${id}`, {
        schema: socialPostSchema,
      });
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

type UseGetSocialPostOptions = {
  id: string;
  queryConfig?: QueryConfig<typeof getSocialPostQueryOptions>;
};

export const useGetSocialPost = ({
  id,
  queryConfig,
}: UseGetSocialPostOptions) => {
  const query = useQuery({
    ...getSocialPostQueryOptions(id),
    ...queryConfig,
  });

  return {
    post: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
