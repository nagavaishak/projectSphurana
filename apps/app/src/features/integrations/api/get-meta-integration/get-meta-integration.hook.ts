import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { GetMetaIntegrationResponse } from '../../types';

export const getMetaIntegrationQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'meta-ads', 'integration'],
    queryFn: () =>
      apiClient.get<GetMetaIntegrationResponse>(
        'integrations/meta-ads/integration'
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseGetMetaIntegrationOptions = {
  queryConfig?: QueryConfig<typeof getMetaIntegrationQueryOptions>;
};

export const useGetMetaIntegration = ({
  queryConfig,
}: UseGetMetaIntegrationOptions = {}) => {
  const query = useQuery({
    ...getMetaIntegrationQueryOptions(),
    ...queryConfig,
  });

  const integration = query.data?.integration ?? null;
  const configurationStatus = integration?.configurationStatus;

  // Only use isPending for skeleton loading state (no cached data)
  // Don't include isFetching - it causes infinite loops when child components
  // with staleTime: 0 trigger refetches that make parent show skeleton
  const isLoading = query.isPending;

  const availableBusinesses = useMemo(
    () => integration?.availableBusinesses ?? [],
    [integration?.availableBusinesses]
  );

  const availableAdAccounts = useMemo(
    () => integration?.availableAdAccounts ?? [],
    [integration?.availableAdAccounts]
  );

  const availablePages = useMemo(
    () => integration?.availablePages ?? [],
    [integration?.availablePages]
  );

  return {
    integration,
    // isConnected means fully configured (not just pending)
    isConnected: configurationStatus === 'configured',
    // isPendingConfiguration means OAuth done, wizard selection needed
    isPendingConfiguration: configurationStatus === 'pending_selection',
    // needsReconnect means the token has expired or been revoked
    needsReconnect: integration?.tokenStatus === 'needs_reconnect',
    // Available options for wizard (only populated when pending_selection)
    // Memoized to prevent new array references on every render from busting
    // downstream useMemo/useCallback dependencies (fixes infinite re-render loop)
    availableBusinesses,
    availableAdAccounts,
    availablePages,
    isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
