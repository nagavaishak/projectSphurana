import { updateOrganizationSettingsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PATCH organization/active` — the org-settings body. `organizationId` comes
 * from the session, so it is absent from the canonical wire contract.
 */
export class UpdateOrganizationSettingsDto extends createZodDto(
  updateOrganizationSettingsRequestSchema
) {}
