import { getUsageHistorySchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Query DTO for `GET /assistant/usage/history`.
 *
 * `organizationId` is stripped — it comes from the session via
 * `@ActiveOrganization()`. The DTO only carries the optional
 * client-controllable filters (`days`, `monthlyMonths`).
 */
export class GetUsageHistoryDto extends createZodDto(
  getUsageHistorySchema.omit({ organizationId: true })
) {}
