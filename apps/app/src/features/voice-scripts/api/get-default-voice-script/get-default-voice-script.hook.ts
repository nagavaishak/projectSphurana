import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { voiceScriptSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { VoiceScript } from '../types';

export const getDefaultVoiceScriptQueryOptions = () => {
  return queryOptions({
    queryKey: ['voice-scripts', 'default'],
    queryFn: async () =>
      apiClient.get<VoiceScript | null>('voice-scripts/default', {
        schema: voiceScriptSchema.nullable(),
      }),
    staleTime: 5 * 60 * 1000,
  });
};

interface UseGetDefaultVoiceScriptOptions {
  queryConfig?: QueryConfig<typeof getDefaultVoiceScriptQueryOptions>;
}

export const useGetDefaultVoiceScript = (
  options?: UseGetDefaultVoiceScriptOptions
) => {
  const query = useQuery({
    ...getDefaultVoiceScriptQueryOptions(),
    ...options?.queryConfig,
  });

  return {
    script: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
