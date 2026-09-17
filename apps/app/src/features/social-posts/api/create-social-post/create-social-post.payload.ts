import { createSocialPostRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import { scheduledAtFromDateTime } from '../scheduled-at';
import type {
  CreateSocialPostIntent,
  CreateSocialPostSchedule,
} from './create-social-post.input';

/**
 * The ONE `POST /social-posts` wire body. `.strict()` so an extra or missing
 * field is a parse error, not a silent strip — the guard against drift between
 * the three create surfaces.
 *
 * All three surfaces post via `pageIds` (platforms are derived server-side),
 * so that is the only destination field here.
 */
export const createSocialPostBodySchema = createSocialPostRequestSchema;

export type CreateSocialPostBody = z.infer<typeof createSocialPostBodySchema>;

function resolveScheduledAt(
  schedule: CreateSocialPostSchedule,
  now: Date,
  timeZone: string
): string {
  if (schedule.mode === 'now') return now.toISOString();
  return scheduledAtFromDateTime(schedule.date, schedule.time, timeZone);
}

/**
 * Build the create body from intent. Owns both the schedule → ISO conversion
 * and the media mapping. `now` is injectable so tests are deterministic.
 *
 * CARRY MEDIA IDENTITY, DON'T FLATTEN IT. This builder used to send `mediaUrl`
 * and nothing else that identified the media, so a carousel arrived at the API
 * indistinguishable from a single image and published as slide 1 — silently,
 * on the customer's live page. `mediaUrls`/`graphicId`/`videoId` have always
 * existed on the wire contract, the service and the publisher; only this
 * function dropped them.
 */
export function buildCreateSocialPostPayload(
  intent: CreateSocialPostIntent,
  timeZone: string,
  now: Date = new Date()
): CreateSocialPostBody {
  return createSocialPostBodySchema.parse({
    title: intent.title,
    caption: intent.caption,
    mediaType: intent.mediaType,
    mediaUrl: intent.mediaUrl,
    // Only a real carousel (2+ slides) carries a list. A one-entry list would
    // be noise the service has to collapse, and an EMPTY list is the
    // blank-vs-absent optional that has broken this codebase's requests
    // before — so a non-carousel omits the key entirely.
    ...(intent.mediaUrls && intent.mediaUrls.length > 1
      ? { mediaUrls: intent.mediaUrls }
      : {}),
    thumbnailUrl: intent.thumbnailUrl,
    graphicId: intent.graphicId,
    videoId: intent.videoId,
    pageIds: intent.pageIds,
    scheduledAt: resolveScheduledAt(intent.schedule, now, timeZone),
  });
}
