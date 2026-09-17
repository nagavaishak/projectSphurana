import { onboardingSlideValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Advance the slide pointer and/or record a slide answer. Both optional so a
 * slide can save an answer without advancing (e.g. mid-slide selections) or
 * advance without an answer (pure Continue slides).
 */
export const updateOnboardingSessionSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  currentSlide: z.enum(onboardingSlideValues).optional(),
  /** Answer recorded under the slide key it belongs to */
  answer: z
    .object({
      slide: z.enum(onboardingSlideValues),
      value: z.unknown(),
    })
    .optional(),
  /**
   * Ad-picker / video-picker selections. These persist to the DEDICATED
   * session columns (`selected_graphic_ids` / `selected_video_id`) — the
   * launch orchestrator reads the columns, not the answers jsonb. They may
   * also arrive embedded in the `answer.value` payload for those slides
   * (the service lifts them out) so plain onAdvance round-trips work too.
   */
  selectedGraphicIds: z.array(z.string().min(1)).max(4).optional(),
  selectedVideoId: z.string().min(1).optional(),
});

export type UpdateOnboardingSessionInput = z.infer<
  typeof updateOnboardingSessionSchema
>;
