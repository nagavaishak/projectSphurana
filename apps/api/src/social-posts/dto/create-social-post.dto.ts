import { createSocialPostRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST social-posts`. This used to be a HAND-COPY of the feature schema that
 * had drifted — it was missing `mediaUrls` (so a carousel silently published as
 * a single image) and `status`. It is now the canonical wire contract, which
 * the feature schema also derives from.
 */
export class CreateSocialPostDto extends createZodDto(
  createSocialPostRequestSchema
) {}
