import { z } from 'zod';

/**
 * UPDATE intent — the typed shape every "edit social post" surface passes to
 * {@link useUpdateSocialPost}. `PUT /social-posts/:id` is a PATCH: each surface
 * edits a different subset of fields (the docked panel edits title + caption +
 * schedule, the calendar drag edits title + caption + schedule from an ISO
 * instant, the mobile detail edits caption only). Every field is therefore
 * optional here; the one builder (`buildUpdateSocialPostPayload`) emits only
 * the keys the surface actually set.
 */

/**
 * How a reschedule was expressed.
 * - `at` — an already-ISO instant (calendar drag-and-drop hands us this).
 * - date + time — a `yyyy-MM-dd` / `HH:mm` pair from a form's pickers.
 *
 * Both resolve to the same `scheduledAt` ISO string via the shared converter.
 */
export const updateSocialPostScheduleSchema = z.union([
  z.object({ at: z.string().min(1) }),
  z.object({ date: z.string().min(1), time: z.string().min(1) }),
]);

export type UpdateSocialPostSchedule = z.infer<
  typeof updateSocialPostScheduleSchema
>;

export interface UpdateSocialPostIntent {
  id: string;
  title?: string;
  /** Raw caption; the builder normalises empty → `null` (clear). */
  caption?: string | null;
  schedule?: UpdateSocialPostSchedule;
}
