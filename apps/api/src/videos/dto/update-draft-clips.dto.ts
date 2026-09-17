import { updateDraftClipsSchema } from '@borradh-workspace/features/videos';
import { createZodDto } from 'nestjs-zod';

/**
 * PUT /videos/:id/draft-clips body — replaces the entire tray with the
 * supplied `clips` array. Used by the frontend on drag-reorder + ✕-remove
 * paths.
 */
export class UpdateDraftClipsDto extends createZodDto(
  updateDraftClipsSchema.omit({ videoId: true, organizationId: true })
) {}
