import { useMemo } from 'react';

import { useActiveOrganization } from '@/features/organization';
import { useListServices } from '@/features/organization-services';
import { useListPractitioners } from '@/features/practitioners';

import type { AppointmentCreateContext } from './appointment-create-form';

/**
 * The one data source every create-appointment surface reads from: the active
 * service list, the active practitioner list, and the business timezone.
 * Desktop and mobile MUST resolve service duration / practitioner tint from the
 * same lists, otherwise their payloads can drift.
 */
export function useAppointmentCreateContext(): AppointmentCreateContext & {
  isLoading: boolean;
} {
  const { services, isLoading: isLoadingServices } = useListServices({
    isActive: true,
    limit: 100,
  });
  const { practitioners, isLoading: isLoadingPractitioners } =
    useListPractitioners({ params: { isActive: true, bookable: true } });
  const { data: organization } = useActiveOrganization();

  const timeZone = organization?.timezone ?? 'UTC';

  // The clinic-wide fallback length for a service that configures none. Read
  // from the SAME org record the timezone comes from, so the staff calendar and
  // the public booking page resolve a null-duration service identically
  // (ENG-793).
  const defaultAppointmentDuration =
    organization?.defaultAppointmentDuration ?? null;

  return useMemo(
    () => ({
      services,
      practitioners,
      timeZone,
      defaultAppointmentDuration,
      isLoading: isLoadingServices || isLoadingPractitioners,
    }),
    [
      services,
      practitioners,
      timeZone,
      defaultAppointmentDuration,
      isLoadingServices,
      isLoadingPractitioners,
    ]
  );
}
