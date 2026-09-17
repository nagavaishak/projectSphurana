import { listAdsSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class ListAdsDto extends createZodDto(
  listAdsSchema.omit({ metaCampaignId: true, organizationId: true })
) {}
