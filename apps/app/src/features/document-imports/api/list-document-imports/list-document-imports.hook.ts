import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { documentImportKeys } from '../keys';
import {
  type DocumentImportListResponse,
  IN_FLIGHT_STATUSES,
  REVIEWABLE_STATUSES,
} from '../types';

const POLL_INTERVAL_MS = 2_000;

export const listDocumentImportsQueryOptions = () =>
  queryOptions({
    queryKey: documentImportKeys.list(),
    queryFn: () =>
      apiClient.get<DocumentImportListResponse>('document-imports?limit=100'),
    staleTime: 30 * 1000,
  });

/**
 * The import dialog's rows. Polls every 2s while anything is still
 * uploading/queued/being read, and stops by itself once every row has
 * settled — so an open dialog with only matched rows costs nothing.
 */
export const useDocumentImports = (options?: { enabled?: boolean }) => {
  const query = useQuery({
    ...listDocumentImportsQueryOptions(),
    enabled: options?.enabled ?? true,
    refetchInterval: (q) =>
      q.state.data?.items.some((i) => IN_FLIGHT_STATUSES.has(i.status))
        ? POLL_INTERVAL_MS
        : false,
  });

  const items = query.data?.items ?? [];
  return {
    imports: items,
    reviewCount: items.filter((i) => REVIEWABLE_STATUSES.has(i.status)).length,
    inFlightCount: items.filter((i) => IN_FLIGHT_STATUSES.has(i.status)).length,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
