import { updateCampaignSchema } from '@borradh-workspace/features/meta-campaigns';
import { createZodDto } from 'nestjs-zod';

export class UpdateCampaignDto extends createZodDto(
  updateCampaignSchema.omit({ metaCampaignId: true, organizationId: true })
) {}
