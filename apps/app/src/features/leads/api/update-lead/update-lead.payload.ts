import { updateLeadRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { UpdateLeadFormValues } from '../../components/lead-detail/update-lead-schema';

/**
 * The wire body for `PUT /leads/:id`, built in exactly one place.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link updateLeadRequestSchema} from `@borradh-workspace/contracts`, the same
 * object the backend's `updateLeadSchema` extends with `id` +
 * `organizationId` and the API DTO validates against. The hand-written mirror
 * that used to live here had already gone soft on `email` (a bare
 * `z.string().optional()` against the server's `.email()`), which is exactly how
 * a blank field turns into a server 400 instead of a client-side error; there is
 * now no mirror to drift.
 *
 * It is `.strict()`, so an extra or missing field is a parse error, not a
 * silent strip — that is what keeps the edit surfaces (the docked lead detail
 * panel, the client details tab, the profile's notes tab) from drifting apart.
 * All of them pass the shared {@link UpdateLeadFormValues} intent; only this
 * builder assembles the request.
 */
export const updateLeadBodySchema = updateLeadRequestSchema;

export type UpdateLeadBody = z.infer<typeof updateLeadBodySchema>;

/**
 * A PARTIAL edit intent: the keys the caller is actually changing.
 *
 * `PUT /leads/:id` is PATCH-shaped — every field is optional and an absent key
 * means "leave unchanged" (see `updateLeadRequestBase`). A surface that edits
 * one field should therefore SEND one field. Passing the whole record instead
 * is what made two independent saves race: each rebuilt the full body from its
 * own last-fetched snapshot of the lead, so the second save re-published the
 * first save's field at its pre-save value — last write wins, silently
 * (ENG-791).
 *
 * The full-form surfaces still pass every key they render, so their body is
 * unchanged apart from no longer mentioning `portalNote` — which they no
 * longer edit.
 *
 * It is `Partial<UpdateLeadFormValues>` PLUS `portalNote`, because the
 * published customer note has no field in the shared form declaration: it is
 * owned by the profile's Notes tab alone. See `updateLeadForm` for why.
 */
export type UpdateLeadIntent = Partial<UpdateLeadFormValues> &
  Partial<Pick<UpdateLeadBody, 'portalNote'>>;

/**
 * Trim a value; treat an empty/whitespace-only string as "leave unchanged".
 *
 * This is the normaliser the contract's format constraints require: `email` is
 * `.email()` and `firstName` is `.min(1)`, so a blank form input (`''`) is not
 * a legal value for either. An update is a partial, so the right encoding of
 * "the user left this box empty" is an ABSENT key, not an empty string.
 */
const clean = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Turns the edit-lead intent into the wire body.
 *
 * Two rules, and the difference between them matters:
 *
 *  - A key the intent does NOT carry is omitted entirely. The caller is not
 *    editing that field, so the server must not touch it.
 *  - A key the intent DOES carry but whose value is an empty optional text
 *    field is also omitted, so the request doesn't fail e.g. an empty string
 *    against the `.email()` rule.
 *
 * `portalNote` is the deliberate exception to the second rule — see below.
 */
export function buildUpdateLeadPayload(
  input: UpdateLeadIntent
): UpdateLeadBody {
  const body: Record<string, unknown> = {};

  /** Copy a key through `transform`, but only if the intent carries it. */
  const put = <K extends keyof UpdateLeadIntent>(
    key: K,
    transform: (value: NonNullable<UpdateLeadIntent[K]>) => unknown
  ) => {
    const value = input[key];
    if (value === undefined) return;
    body[key] = transform(value as NonNullable<UpdateLeadIntent[K]>);
  };

  put('firstName', clean);
  put('lastName', clean);
  put('email', clean);
  put('phone', clean);
  put('whatsapp', clean);
  put('source', (value) => value);
  put('status', (value) => value);
  put('tags', (value) => value);
  // The two note fields are NOT `clean()`ed, and for the same reason: a
  // free-text box the user can empty must be able to SAY "empty". `clean('')`
  // encodes "leave unchanged", so a user who cleared the box, hit save and saw
  // "Client updated successfully" would find the old text still there after a
  // reload — the same false-success shape as ENG-791 itself.
  //
  // `clean()` exists for the FORMAT-CONSTRAINED fields above (`firstName` is
  // `.min(1)`, `email` is `.email()`), where `''` is not a legal value and the
  // only sane reading of a blank box is "not editing this". Neither note has
  // such a constraint — both are plain `z.string().optional()` — so `''` is a
  // legal value that means exactly what it looks like.
  //
  // Absent still means "leave unchanged", which is precisely why the key must
  // not be sent by a caller that isn't editing it: a surface that round-tripped
  // `lead.portalNote ?? ''` was silently CLEARING the customer's published note
  // every time it saved something else.
  put('notes', (value) => value.trim());
  put('portalNote', (value) => value.trim());
  put('consentEmail', (value) => value);
  put('consentSms', (value) => value);
  put('consentVoice', (value) => value);

  return updateLeadBodySchema.parse(body);
}
