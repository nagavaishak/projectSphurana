import { listAppointmentResourcesSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Query for GET /resources/allocations — the calendar's resource holds for a
 * window. See `resource-utilisation.dto.ts` for why the coerced dates on the
 * feature schema are what makes this safe over the wire.
 */
export class ListAppointmentResourcesDto extends createZodDto(
  listAppointmentResourcesSchema.omit({ organizationId: true })
) {}
