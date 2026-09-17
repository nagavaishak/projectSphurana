import { updateOrgDefaultsSchema } from '@borradh-workspace/features/org-defaults';
import { createZodDto } from 'nestjs-zod';

/**
 * Body shape for `PATCH /org-defaults`. `organizationId` is omitted because
 * the controller pulls it from the session via `@ActiveOrganization()`.
 *
 * Every value is optional; `null` explicitly clears a previously-set
 * override (which then falls back to the system default at read time).
 */
export class UpdateOrgDefaultsDto extends createZodDto(
  updateOrgDefaultsSchema.omit({ organizationId: true })
) {}
