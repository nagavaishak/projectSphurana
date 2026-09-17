import { upsertCampaignMessageRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpsertCampaignMessageDto extends createZodDto(
  upsertCampaignMessageRequestSchema
) {}
