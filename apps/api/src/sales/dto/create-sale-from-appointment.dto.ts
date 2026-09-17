import { createSaleFromAppointmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /sales/from-appointment` body. Validated against the CANONICAL wire
 * contract; the controller injects `organizationId` and `createdById`.
 */
export class CreateSaleFromAppointmentDto extends createZodDto(
  createSaleFromAppointmentRequestSchema
) {}
