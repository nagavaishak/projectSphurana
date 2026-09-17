import { createCampaignRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST campaigns`. The canonical wire contract already excludes the
 * server-injected `organizationId` / `createdById`.
 */
export class CreateCampaignDto extends createZodDto(
  createCampaignRequestSchema
) {}
