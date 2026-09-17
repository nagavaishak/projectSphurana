import { setServiceResourceRequirementsSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for PUT /resources/requirements/:serviceId — the COMPLETE requirement
 * set for one service. `serviceId` is the route param.
 *
 * An empty `eligibleResourceIds` means "any resource in this category" and is
 * NOT the same as omitting the requirement; the feature service is what
 * encodes that, and this DTO deliberately does not reinterpret it.
 */
export class SetServiceResourceRequirementsDto extends createZodDto(
  setServiceResourceRequirementsSchema.omit({
    organizationId: true,
    serviceId: true,
  })
) {}
