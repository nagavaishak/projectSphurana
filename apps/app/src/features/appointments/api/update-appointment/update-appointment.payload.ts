import { updateAppointmentRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { UpdateAppointmentIntent } from './update-appointment.input';

/**
 * SHARED CORE — update appointment.
 *
 * The `.strict()` wire body for `PUT appointments/:id`, and the ONE place it is
 * constructed. Every surface (calendar drag/resize, the edit dialog, the mobile
 * booking sheet, the quick-actions menu, the status stepper) routes its intent
 * through {@link buildUpdateAppointmentPayload} via the update hook — see the
 * form-contract test (`update-appointment.contract.test.tsx`).
 *
 * The schema is NOT declared here — it is the canonical
 * {@link updateAppointmentRequestSchema} from `@borradh-workspace/contracts`,
 * the same object the backend's `updateAppointmentBaseSchema` extends with the
 * route `id` and `organizationId` and the API DTO validates against. The
 * hand-written mirror this replaces typed `color` and `status` as bare
 * `z.string()`, so a stale enum value was a client-side pass and a server-side
 * 400; there is now no mirror to drift.
 *
 * Every field is optional because the backend applies PATCH semantics: a key
 * that is absent from the body is left untouched (NOT set to null). The builder
 * therefore emits ONLY the keys the caller actually set — a `null` is a
 * deliberate "clear this column", an omitted key is "leave it alone".
 * `.strict()` makes an unknown/misspelled field a parse error rather than a
 * silent strip.
 */
export const updateAppointmentBodySchema = updateAppointmentRequestSchema;

/**
 * The wire body. Assignment fields keep their brands so downstream code (and
 * the parity test) can still tell a `UserId` from a `PractitionerId`.
 */
export type UpdateAppointmentBody = z.infer<
  typeof updateAppointmentBodySchema
> &
  Pick<UpdateAppointmentIntent, 'assignedToId' | 'practitionerId'>;

/**
 * `assignedToId` is the one nullable-looking intent field the SERVER has never
 * accepted as `null` (`z.string().min(1).optional()` — a booking always belongs
 * to someone). `updateIntentFromCalendarEvent` nonetheless emits `null` when a
 * calendar event carries no `user.id`, which used to sail past the frontend's
 * hand-written mirror and 400 at the API. Now that the wire schema is the
 * canonical one, a `null` here means "the event told us nothing" — which in
 * PATCH terms is "leave the assignee alone", i.e. omit the key.
 */
const dropNullAssignee = (
  body: Record<string, unknown>
): Record<string, unknown> => {
  if (body.assignedToId !== null) return body;
  const { assignedToId: _null, ...rest } = body;
  return rest;
};

/**
 * THE ONLY place a `PUT appointments/:id` body is constructed. Strips the route
 * `id`, drops every `undefined` field (preserving PATCH semantics — undefined
 * means "don't touch"), and validates the remainder against the strict schema.
 */
export function buildUpdateAppointmentPayload(
  intent: UpdateAppointmentIntent
): UpdateAppointmentBody {
  const { id: _id, ...rest } = intent;
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  );
  return updateAppointmentBodySchema.parse(
    dropNullAssignee(defined)
  ) as UpdateAppointmentBody;
}
