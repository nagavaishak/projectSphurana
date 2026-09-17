import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listMetaLeadFormsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListMetaLeadFormsResponse } from '../../types';

export const listMetaLeadFormsQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'meta-ads', 'lead-forms'],
    queryFn: () =>
      apiClient.get<ListMetaLeadFormsResponse>(
        'integrations/meta-ads/lead-forms',
        { schema: listMetaLeadFormsResponseSchema }
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListMetaLeadFormsOptions = {
  queryConfig?: QueryConfig<typeof listMetaLeadFormsQueryOptions>;
  enabled?: boolean;
};

export const useListMetaLeadForms = ({
  queryConfig,
  enabled = true,
}: UseListMetaLeadFormsOptions = {}) => {
  const query = useQuery({
    ...listMetaLeadFormsQueryOptions(),
    enabled,
    ...queryConfig,
  });

  return {
    forms: query.data?.forms ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
