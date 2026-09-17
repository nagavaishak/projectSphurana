import { apiClient } from '@borradh-workspace/api-client';
import { listAppointmentsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppointmentListResponse, AppointmentStatus } from '../types';

/**
 * Hook-level params that accept Date objects for convenience.
 * The hook converts Date objects to ISO strings for the API.
 */
interface UseListAppointmentsParams {
  leadId?: string;
  assignedToId?: string;
  status?: AppointmentStatus;
  startDateFrom?: Date | string;
  startDateTo?: Date | string;
  limit?: number;
  offset?: number;
}

/**
 * Convert Date to ISO string, pass strings through
 */
function toISOString(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;
  return date instanceof Date ? date.toISOString() : date;
}

export const listAppointmentsQueryOptions = (
  params: UseListAppointmentsParams = {}
) => {
  const searchParams = new URLSearchParams();

  if (params.leadId) searchParams.set('leadId', params.leadId);
  if (params.assignedToId)
    searchParams.set('assignedToId', params.assignedToId);
  if (params.status) searchParams.set('status', params.status);

  const startDateFrom = toISOString(params.startDateFrom);
  if (startDateFrom) searchParams.set('startDateFrom', startDateFrom);

  const startDateTo = toISOString(params.startDateTo);
  if (startDateTo) searchParams.set('startDateTo', startDateTo);

  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));

  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['appointments', 'list', params],
    queryFn: () =>
      // Runtime-validated against the list projection (report mode).
      apiClient.get<AppointmentListResponse>(
        `appointments${qs ? `?${qs}` : ''}`,
        { schema: listAppointmentsResponseSchema }
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

export const useListAppointments = (
  params: UseListAppointmentsParams = {},
  options: { enabled?: boolean } = {}
) => {
  const query = useQuery({
    ...listAppointmentsQueryOptions(params),
    enabled: options.enabled,
  });

  return {
    appointments: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
