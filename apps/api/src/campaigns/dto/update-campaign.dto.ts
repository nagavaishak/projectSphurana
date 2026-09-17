import { updateCampaignRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT campaigns/:id`. `id` is the route param, `organizationId` the session. */
export class UpdateCampaignDto extends createZodDto(
  updateCampaignRequestSchema
) {}
