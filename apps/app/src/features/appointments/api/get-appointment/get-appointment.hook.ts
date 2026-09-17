import { apiClient } from '@borradh-workspace/api-client';
import { appointmentWithRelationsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppointmentWithRelations } from '../types';

export const getAppointmentQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['appointments', id],
    queryFn: () =>
      // Endpoint returns the appointment with its joined relations; validated
      // against the with-relations projection (report mode).
      // Typed WITH relations: the endpoint joins lead, service, assignedTo and
      // deposit, and `appointmentWithRelationsSchema` validates them. The type
      // used to say plain `Appointment`, which made every consumer cast to
      // reach fields the response already carried.
      apiClient.get<AppointmentWithRelations>(`appointments/${id}`, {
        schema: appointmentWithRelationsSchema,
      }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const useGetAppointment = (id: string) => {
  const query = useQuery(getAppointmentQueryOptions(id));

  return {
    appointment: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
