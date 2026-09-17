import { listCampaignsSchema } from '@borradh-workspace/features/meta-campaigns';
import { createZodDto } from 'nestjs-zod';

export class ListCampaignsDto extends createZodDto(
  listCampaignsSchema.omit({ organizationId: true })
) {}
