import { createCampaignSchema } from '@borradh-workspace/features/meta-campaigns';
import { createZodDto } from 'nestjs-zod';

export class CreateCampaignDto extends createZodDto(
  createCampaignSchema.omit({ organizationId: true })
) {}
