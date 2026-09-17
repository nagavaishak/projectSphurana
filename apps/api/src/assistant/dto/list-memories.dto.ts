import { listMemoriesSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Query DTO for `GET /assistant/memories`.
 *
 * `organizationId` and `userId` are stripped — they come from the session
 * via `@ActiveOrganization()` and `@CurrentUser('id')`. The DTO only carries
 * the optional client-controllable filters (`type`, `limit`, `offset`).
 */
export class ListMemoriesDto extends createZodDto(
  listMemoriesSchema.omit({
    organizationId: true,
    userId: true,
  })
) {}
