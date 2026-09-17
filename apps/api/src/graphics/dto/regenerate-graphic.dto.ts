import { regenerateGraphicSchema } from '@borradh-workspace/features/graphics';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /graphics/:id/regenerate. `graphicId` comes from the path,
 * `organizationId` + `createdById` from the session.
 */
export class RegenerateGraphicDto extends createZodDto(
  regenerateGraphicSchema.omit({
    organizationId: true,
    graphicId: true,
    createdById: true,
  })
) {}
