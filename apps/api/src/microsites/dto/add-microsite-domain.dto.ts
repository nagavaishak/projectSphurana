import { addMicrositeDomainSchema } from '@borradh-workspace/features/microsites';
import { createZodDto } from 'nestjs-zod';

/**
 * `micrositeId` comes from the route and `organizationId` from the session —
 * never from the body, or a caller could attach a domain to another tenant's
 * site.
 */
export class AddMicrositeDomainDto extends createZodDto(
  addMicrositeDomainSchema.omit({ micrositeId: true, organizationId: true })
) {}
