import { cancelPatientBookingSchema } from '@borradh-workspace/features/patient-bookings';
import { createZodDto } from 'nestjs-zod';

/**
 * Body of POST patient/bookings/:id/cancel. leadId/organizationId come from
 * the validated patient session (never the client); appointmentId from the
 * route param.
 */
export class CancelPatientBookingDto extends createZodDto(
  cancelPatientBookingSchema.omit({
    leadId: true,
    organizationId: true,
    appointmentId: true,
  })
) {}
