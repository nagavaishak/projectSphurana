import { draftCampaignContentSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from the active org; businessName is resolved
// server-side, so only channel + prompt are accepted from the client.
export class DraftCampaignContentDto extends createZodDto(
  draftCampaignContentSchema.omit({ organizationId: true, businessName: true })
) {}
