import { reschedulePatientBookingSchema } from '@borradh-workspace/features/patient-bookings';
import { createZodDto } from 'nestjs-zod';

/**
 * Body of POST patient/bookings/:id/reschedule. leadId/organizationId come
 * from the validated patient session; appointmentId from the route param.
 */
export class ReschedulePatientBookingDto extends createZodDto(
  reschedulePatientBookingSchema.omit({
    leadId: true,
    organizationId: true,
    appointmentId: true,
  })
) {}
