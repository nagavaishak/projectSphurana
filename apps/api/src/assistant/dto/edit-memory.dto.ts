import { editMemorySchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Body DTO for `PATCH /assistant/memories/:id`.
 *
 * `id` comes from the route param; `organizationId` + `userId` come from
 * the session — only the client-supplied `content` remains.
 */
export class EditMemoryDto extends createZodDto(
  editMemorySchema.omit({
    id: true,
    organizationId: true,
    userId: true,
  })
) {}
