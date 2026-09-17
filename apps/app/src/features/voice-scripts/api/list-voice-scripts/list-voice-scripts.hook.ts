import { apiClient } from '@borradh-workspace/api-client';
import { listVoiceScriptsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListVoiceScriptsResponse } from '../types';

interface ListVoiceScriptsParams {
  limit?: number;
  offset?: number;
}

export const listVoiceScriptsQueryOptions = (
  params: ListVoiceScriptsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['voice-scripts', 'list', params],
    queryFn: async () =>
      apiClient.get<ListVoiceScriptsResponse>(
        `voice-scripts${qs ? `?${qs}` : ''}`,
        { schema: listVoiceScriptsResponseSchema }
      ),
    staleTime: 60 * 1000,
  });
};

type UseListVoiceScriptsOptions = {
  params?: ListVoiceScriptsParams;
};

export const useListVoiceScripts = ({
  params = {},
}: UseListVoiceScriptsOptions = {}) => {
  const query = useQuery(listVoiceScriptsQueryOptions(params));

  return {
    scripts: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
