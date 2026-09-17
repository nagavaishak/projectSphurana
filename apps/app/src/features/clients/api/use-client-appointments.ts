import { apiClient } from '@borradh-workspace/api-client';
import type { AppointmentListResponse } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Thin query hook: appointments for a single client (lead).
 *
 * Defined locally under `features/clients/api` (rather than reusing the
 * appointments feature) so this workstream stays disjoint from the
 * scheduling/appointments agents at merge time. Hits the live
 * `GET /appointments?leadId=` endpoint.
 */
export const clientAppointmentsQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: ['clients', leadId, 'appointments'],
    queryFn: () => {
      const params = new URLSearchParams({ leadId, limit: '200' });
      return apiClient.get<AppointmentListResponse>(
        `appointments?${params.toString()}`
      );
    },
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });

export const useClientAppointments = (leadId: string) => {
  const query = useQuery(clientAppointmentsQueryOptions(leadId));
  return {
    appointments: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
