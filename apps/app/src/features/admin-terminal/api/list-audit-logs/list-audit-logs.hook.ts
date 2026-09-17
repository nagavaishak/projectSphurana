import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  actorType: 'user' | 'system' | 'job';
  actorId: string | null;
  organizationId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ListAuditLogsResponse {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface ListAuditLogsParams {
  organizationId?: string;
  entityType?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

export const listAuditLogsQueryOptions = (params: ListAuditLogsParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.organizationId)
    searchParams.set('organizationId', params.organizationId);
  if (params.entityType) searchParams.set('entityType', params.entityType);
  if (params.action) searchParams.set('action', params.action);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['admin-terminal', 'audit-logs', params],
    queryFn: () =>
      apiClient.get<ListAuditLogsResponse>(
        `admin-terminal/audit-logs${qs ? `?${qs}` : ''}`
      ),
    staleTime: 10 * 1000,
  });
};

export const useListAuditLogs = (params: ListAuditLogsParams = {}) => {
  const query = useQuery(listAuditLogsQueryOptions(params));
  return {
    logs: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { AuditLogEntry, ListAuditLogsParams };
