import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { ConsentFormTemplateListResponse } from '../types';

/** Backend built in parallel — if the path moves, adjust it here only. */
const ENDPOINT = 'consent-form-templates';

export const listConsentFormTemplatesQueryOptions = () =>
  queryOptions({
    // The list takes no params, so it IS the root — `.list()` would append an
    // `undefined` segment the mutations' `all()` invalidation still reaches,
    // but the key would no longer be the one this query has always used.
    queryKey: queryKeys.consentFormTemplates.all(),
    queryFn: () => apiClient.get<ConsentFormTemplateListResponse>(ENDPOINT),
    staleTime: 60 * 1000,
  });

export const useListConsentFormTemplates = () => {
  const query = useQuery(listConsentFormTemplatesQueryOptions());

  return {
    templates: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
