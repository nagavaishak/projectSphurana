import { summariseRecentLeadsSchema } from '@borradh-workspace/features/leads';
import { createZodDto } from 'nestjs-zod';

/**
 * Query DTO for `GET /leads/summary`. The features-package schema owns the
 * shape; we omit `organizationId` because it's injected from the active-org
 * decorator at the controller boundary.
 */
export class SummariseRecentLeadsDto extends createZodDto(
  summariseRecentLeadsSchema.omit({ organizationId: true })
) {}
