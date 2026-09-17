/**
 * Per-owner proactive-nudge opt-out (WS-11, plan §4 WS-11).
 *
 * The brief forbids a new migration. Neither `assistant_whatsapp_link` nor
 * `assistant_conversation` has a free jsonb/metadata column to hang an opt-out
 * preference on (`pendingConfirmation` is reserved for the confirmation gate),
 * so there is NO durable home for the preference today. We therefore implement
 * the opt-out check against an env-driven stub: a comma-separated allow-list of
 * opted-out owner phone numbers (E.164 digits).
 *
 * FOLLOW-UP (future migration, NOT in this WS): add a persistent opt-out — the
 * cleanest home is a `nudgeOptOutAt timestamp` (or `proactiveNudgesEnabled
 * boolean`) column on `assistant_whatsapp_link`, surfaced as a toggle on the
 * WhatsApp pairing settings card (apps/app). Until then this env stub lets the
 * operator suppress a specific owner without a deploy of new schema.
 */

export interface NudgeOptOutConfig {
  /** Comma/space-separated E.164 phone numbers (digits only) that opted out. */
  optedOutPhones?: string;
}

/**
 * Parse the env-stub opt-out list into a normalized Set of E.164 digits.
 */
export function parseOptOutPhones(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((p) => p.replace(/[^\d]/g, ''))
      .filter((p) => p.length > 0)
  );
}

/**
 * Is this owner opted out of proactive nudges? Stub-backed (see file header).
 */
export function isOptedOut(phoneE164: string, optedOut: Set<string>): boolean {
  return optedOut.has(phoneE164.replace(/[^\d]/g, ''));
}
