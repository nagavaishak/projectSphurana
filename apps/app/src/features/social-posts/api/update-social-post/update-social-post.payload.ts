import { updateSocialPostRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import { scheduledAtFromDateTime } from '../scheduled-at';
import type {
  UpdateSocialPostIntent,
  UpdateSocialPostSchedule,
} from './update-social-post.input';

/**
 * The ONE `PUT /social-posts/:id` wire body — the canonical contract from
 * `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * `.strict()` and every field optional — a PATCH. The builder only sets a key
 * when the surface's intent carried it, so the caption-only mobile surface and
 * the full desktop panel emit their respective subsets from one code path.
 */
export const updateSocialPostBodySchema = updateSocialPostRequestSchema;

/**
 * The body as it goes ON THE WIRE — `z.input`, not `z.infer`.
 *
 * The contract's `scheduledAt` is `z.coerce.date()` because the SERVER wants a
 * `Date`. Parsing therefore yields a `Date`, but what we send is the ISO string
 * the surfaces already hold. `z.input` is the pre-coercion shape, which is
 * exactly the wire shape — see {@link buildUpdateSocialPostPayload}, which
 * parses for validation and returns the original object.
 */
export type UpdateSocialPostBody = z.input<typeof updateSocialPostBodySchema>;

/** Empty caption clears the field — every surface agrees on `'' → null`. */
function normaliseCaption(caption: string | null): string | null {
  return caption ? caption : null;
}

function resolveScheduledAt(
  schedule: UpdateSocialPostSchedule,
  timeZone: string
): string {
  return 'at' in schedule
    ? schedule.at
    : scheduledAtFromDateTime(schedule.date, schedule.time, timeZone);
}

/**
 * Build the PATCH body from partial intent. Owns caption normalisation and the
 * schedule → ISO conversion. Returns only the keys the surface set.
 *
 * Validates against the contract but returns the PRE-parse object, so the
 * request keeps carrying `scheduledAt` as the ISO string rather than the
 * coerced `Date` the server-side half of the contract produces.
 */
export function buildUpdateSocialPostPayload(
  intent: UpdateSocialPostIntent,
  timeZone: string
): UpdateSocialPostBody {
  const body: UpdateSocialPostBody = {};
  if (intent.title !== undefined) body.title = intent.title;
  if (intent.caption !== undefined)
    body.caption = normaliseCaption(intent.caption);
  if (intent.schedule !== undefined) {
    body.scheduledAt = resolveScheduledAt(intent.schedule, timeZone);
  }
  updateSocialPostBodySchema.parse(body);
  return body;
}
