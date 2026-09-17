import { createLeadRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { CreateLeadFormValues } from '../../components/create-lead-schema';

/**
 * The wire body for `POST /leads`, built in exactly one place.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createLeadRequestSchema} from `@borradh-workspace/contracts`, the same
 * object the backend's `createLeadSchema` extends with `organizationId` and the
 * API DTO validates against. A hand-written mirror in this file is what let the
 * frontend accept `email: ''` while the server rejected it; there is now no
 * mirror to drift.
 *
 * It is `.strict()`, so an extra or missing field is a parse error, not a
 * silent strip — that is what stops the three create surfaces (the desktop
 * dialog and the two mobile new-client funnels) from drifting apart. Every
 * surface passes the shared {@link CreateLeadFormValues} intent; only this
 * builder assembles the request.
 */
export const createLeadBodySchema = createLeadRequestSchema;

export type CreateLeadBody = z.infer<typeof createLeadBodySchema>;

/**
 * A blank optional text input is ABSENT on the wire, not an empty string.
 *
 * `email` is the field that made this urgent — the contract requires a
 * well-formed address when the key is present, so `''` was a live 400. The rest
 * are merely loose enough to accept `''` today: nothing breaks, but the record
 * then says "this client's phone number is the empty string" rather than "this
 * client has no phone number", and the next field to gain a format rule becomes
 * the next `POST /leads`. `buildUpdateLeadPayload` has always cleaned all of
 * them; create is the surface that did not.
 */
const orUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Turns the create-lead form intent into the wire body.
 *
 * Consent defaults (unchecked box => `false`) live here so the three UI
 * surfaces no longer copy-paste them. `consentSource` is only `'manual_entry'`
 * when the client actually consented to at least one channel — recording a
 * consent source for a client who granted no consent is meaningless, and the
 * backend only stamps `consentedAt` when there is consent.
 *
 * `email` is normalised through {@link orUndefined}: the form's blank default is
 * `''`, and the contract (like the server) requires a well-formed address when
 * the key is present. Sending `''` was a live 400 — "Invalid email format" on a
 * client who simply has no email.
 */
export function buildCreateLeadPayload(
  input: CreateLeadFormValues
): CreateLeadBody {
  const consentEmail = input.consentEmail ?? false;
  const consentSms = input.consentSms ?? false;
  const consentVoice = input.consentVoice ?? false;
  const hasAnyConsent = consentEmail || consentSms || consentVoice;

  return createLeadBodySchema.parse({
    firstName: input.firstName.trim(),
    lastName: orUndefined(input.lastName),
    email: orUndefined(input.email),
    phone: orUndefined(input.phone),
    whatsapp: orUndefined(input.whatsapp),
    source: input.source,
    tags: input.tags,
    notes: orUndefined(input.notes),
    consentEmail,
    consentSms,
    consentVoice,
    consentSource: hasAnyConsent ? 'manual_entry' : undefined,
  });
}
