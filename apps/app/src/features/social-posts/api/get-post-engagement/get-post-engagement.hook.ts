import { apiClient } from '@borradh-workspace/api-client';
import {
  type PostEngagement,
  postEngagementSchema,
} from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export type { PostEngagement };

export const getPostEngagementQueryOptions = (id: string, platform?: string) =>
  queryOptions({
    queryKey: ['social-posts', id, 'engagement', platform],
    queryFn: () => {
      const params = platform ? `?platform=${platform}` : '';
      return apiClient.get<PostEngagement>(
        `social-posts/${id}/engagement${params}`,
        { schema: postEngagementSchema }
      );
    },
    enabled: !!id,
    staleTime: 60_000,
    retry: false,
  });

export const useGetPostEngagement = (id: string, platform?: string) => {
  const query = useQuery(getPostEngagementQueryOptions(id, platform));
  return {
    engagement: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
