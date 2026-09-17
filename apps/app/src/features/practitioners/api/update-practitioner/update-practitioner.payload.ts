import type { PractitionerSocialLinks } from '@borradh-workspace/api-client/types';
import { updatePractitionerRequestSchema } from '@borradh-workspace/contracts';

import type {
  UpdatePractitionerBody,
  UpdatePractitionerIntent,
} from './update-practitioner.input';

/**
 * The ONE place a `PUT practitioners/:id` body is assembled.
 *
 * Field-builder helpers normalise each logical field exactly once, so wherever
 * a field is edited it lands on the wire identically:
 *   - free text  → trimmed, empty becomes `null` (clear), not omitted-vs-null
 *     drift between surfaces;
 *   - enum-ish selectors → `''` (unset) becomes `null`;
 *   - social handles → empty entries dropped.
 *
 * Only the intent keys a surface actually provides end up in the body (PATCH).
 * The body schema is `.strict()`, so an extra or renamed key is a parse error
 * rather than a silent strip.
 */

/** Trimmed string, or `null` when empty (the shared "clear this field" rule). */
function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enum-ish selector value, or `null` when unset (`''`). */
function enumOrNull<T extends string>(
  value: T | '' | null | undefined
): T | null {
  return value ? (value as T) : null;
}

/** Drop empty handles so we never persist blank social strings. */
function normalizeSocialLinks(
  social: PractitionerSocialLinks
): PractitionerSocialLinks {
  const out: PractitionerSocialLinks = {};
  for (const [key, val] of Object.entries(social)) {
    if (typeof val === 'string' && val.trim()) {
      out[key as keyof PractitionerSocialLinks] = val.trim();
    }
  }
  return out;
}

/**
 * Wire body shape.
 *
 * NOT declared here — it is the canonical
 * {@link updatePractitionerRequestSchema} from `@borradh-workspace/contracts`,
 * the same object the backend's `updatePractitionerSchema` extends with `id` +
 * `organizationId` and the API DTO validates against. The hand-written mirror
 * this replaced had every enum widened to `z.string()` and no length limits, so
 * it green-lit bodies the server rejected (an unknown `country` code, a
 * >64-char `headline`, a >1000-char `notes`). There is now no mirror to drift.
 */
export const updatePractitionerBodySchema = updatePractitionerRequestSchema;

/** Map the typed intent to the wire body, one field-builder per field. */
export function buildUpdatePractitionerPayload(
  intent: UpdatePractitionerIntent
): UpdatePractitionerBody {
  const body: Record<string, unknown> = {};

  // `name` and `email` are the two fields that are OPTIONAL but constrained
  // (`.min(1)` / `.email()`), so `''` is neither "absent" nor valid. A blank
  // input is OMITTED — sending `''` was a live 400, and against the contract it
  // would now be a client-side parse throw. Omitting is also the correct
  // semantics: PATCH, so "leave it alone", never "blank the person's name".
  if (intent.name !== undefined) {
    const name = intent.name.trim();
    if (name) body.name = name;
  }
  if (intent.firstName !== undefined)
    body.firstName = trimOrNull(intent.firstName);
  if (intent.lastName !== undefined)
    body.lastName = trimOrNull(intent.lastName);
  if (intent.email !== undefined) {
    const email = intent.email.trim();
    if (email) body.email = email;
  }
  if (intent.phone !== undefined) body.phone = trimOrNull(intent.phone);
  if (intent.phoneSecondary !== undefined)
    body.phoneSecondary = trimOrNull(intent.phoneSecondary);
  if (intent.phoneCountry !== undefined)
    body.phoneCountry = trimOrNull(intent.phoneCountry);
  if (intent.country !== undefined) body.country = enumOrNull(intent.country);
  if (intent.photo !== undefined) body.photo = trimOrNull(intent.photo);
  if (intent.bio !== undefined) body.bio = trimOrNull(intent.bio);
  if (intent.title !== undefined) body.title = trimOrNull(intent.title);
  if (intent.headline !== undefined)
    body.headline = trimOrNull(intent.headline);
  if (intent.dateOfBirth !== undefined)
    body.dateOfBirth = trimOrNull(intent.dateOfBirth);
  if (intent.employmentStartDate !== undefined)
    body.employmentStartDate = trimOrNull(intent.employmentStartDate);
  if (intent.employmentEndDate !== undefined)
    body.employmentEndDate = trimOrNull(intent.employmentEndDate);
  if (intent.employmentType !== undefined)
    body.employmentType = enumOrNull(intent.employmentType);
  if (intent.teamMemberRef !== undefined)
    body.teamMemberRef = trimOrNull(intent.teamMemberRef);
  if (intent.notes !== undefined) body.notes = trimOrNull(intent.notes);
  if (intent.acceptsBookings !== undefined)
    body.acceptsBookings = intent.acceptsBookings;
  if (intent.languages !== undefined) body.languages = intent.languages;
  if (intent.socialLinks !== undefined)
    body.socialLinks = normalizeSocialLinks(intent.socialLinks);
  if (intent.color !== undefined) body.color = enumOrNull(intent.color);
  if (intent.workingHours !== undefined)
    body.workingHours = intent.workingHours;

  return updatePractitionerBodySchema.parse(body) as UpdatePractitionerBody;
}
