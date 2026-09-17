import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { AppointmentFormSubmissionsResponse } from '../types';

/** Backend built in parallel — if the path moves, adjust it here only. */
const endpoint = (appointmentId: string) =>
  `consent-form-templates/submissions?appointmentId=${encodeURIComponent(appointmentId)}`;

export const listAppointmentFormSubmissionsQueryOptions = (
  appointmentId: string
) =>
  queryOptions({
    queryKey: queryKeys.consentFormSubmissions.forAppointment(appointmentId),
    queryFn: () =>
      apiClient.get<AppointmentFormSubmissionsResponse>(
        endpoint(appointmentId)
      ),
    enabled: !!appointmentId,
    staleTime: 30 * 1000,
  });

export const useListAppointmentFormSubmissions = (appointmentId: string) => {
  const query = useQuery(
    listAppointmentFormSubmissionsQueryOptions(appointmentId)
  );

  return {
    submissions: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
