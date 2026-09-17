import { socialPostMediaTypeValues } from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * CREATE intent — the typed shape every "new social post" surface passes to
 * {@link useCreateSocialPost}. This is NOT the wire body; it is the form-values
 * shape the three surfaces (content-calendar dialog, mobile wizard,
 * content-studio dialog) all naturally have. The one builder
 * (`buildCreateSocialPostPayload`) turns it into the `POST /social-posts` body,
 * so no surface can assemble that body differently.
 */

/**
 * How the post should be scheduled.
 * - `now` — publish immediately (`scheduledAt` becomes the current instant).
 * - `schedule` — a future `yyyy-MM-dd` date + `HH:mm` time picked in the form.
 */
export const createSocialPostScheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('now') }),
  z.object({
    mode: z.literal('schedule'),
    date: z.string().min(1),
    time: z.string().min(1),
  }),
]);

export type CreateSocialPostSchedule = z.infer<
  typeof createSocialPostScheduleSchema
>;

export const createSocialPostIntentSchema = z.object({
  title: z.string(),
  caption: z.string().optional(),
  mediaType: z.enum(socialPostMediaTypeValues),
  mediaUrl: z.string(),
  /**
   * Every slide of an image carousel, in order. ABSENT — never `[]` — for a
   * single image or a video.
   *
   * These three fields are media IDENTITY, not form fields: a surface carries
   * them in from whatever the user picked, they are never typed. Dropping them
   * is what published a five-slide carousel as its first slide alone —
   * `mediaUrl` is only ever slide 1, and with neither `mediaUrls` nor
   * `graphicId` on the row the publisher has nothing left to expand from.
   */
  mediaUrls: z.array(z.string()).optional(),
  thumbnailUrl: z.string().optional(),
  /**
   * The generated asset this post publishes. The publisher re-resolves a
   * carousel's slides from `graphicId` at publish time, which is both why a
   * post carrying it stays repairable when `mediaUrls` is absent, and why we
   * send the reference rather than only the (signed, expiring) URLs.
   */
  graphicId: z.string().optional(),
  videoId: z.string().optional(),
  pageIds: z.array(z.string()),
  schedule: createSocialPostScheduleSchema,
});

export type CreateSocialPostIntent = z.infer<
  typeof createSocialPostIntentSchema
>;
