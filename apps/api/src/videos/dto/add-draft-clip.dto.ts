import { addDraftClipSchema } from '@borradh-workspace/features/videos';
import { createZodDto } from 'nestjs-zod';

/**
 * POST /videos/:id/draft-clips body — single-row append OR multi-row replace
 * via the discriminated `clips` field. The route accepts either shape so
 * `videos_autoSelectClips` can persist N suggestions in one round-trip and
 * the frontend single-drop handler can persist one row at a time.
 */
export class AddDraftClipDto extends createZodDto(
  addDraftClipSchema.omit({ videoId: true, organizationId: true })
) {}
