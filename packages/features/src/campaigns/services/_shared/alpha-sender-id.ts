/**
 * Alphanumeric SMS sender IDs ("BloomHair") for campaign marketing.
 *
 * Carrier rules (Twilio / EU networks):
 *   - 1–11 characters
 *   - letters + digits only (spaces are accepted by some carriers but dropped
 *     by others, so we strip them for a stable, portable identifier)
 *   - MUST contain at least one letter — an all-numeric value would be read as
 *     a phone number, not a sender ID
 *
 * See docs/plans/sms-alphanumeric-v1.md.
 */

export const ALPHA_SENDER_ID_MAX_LENGTH = 11;

/** True when `id` is a valid alphanumeric sender ID per carrier rules. */
export function isValidAlphaSenderId(id: string): boolean {
  if (id.length < 1 || id.length > ALPHA_SENDER_ID_MAX_LENGTH) return false;
  if (!/^[A-Za-z0-9]+$/.test(id)) return false;
  // Must contain a letter — all-digits reads as a number, not a sender ID.
  if (!/[A-Za-z]/.test(id)) return false;
  return true;
}

/**
 * Derive a valid sender ID from an org name. Strips accents and any character
 * outside [A-Za-z0-9], then truncates to 11 chars.
 *
 * Returns null when the name cannot yield a valid ID (empty, or reduces to
 * digits only) — the caller must then require an explicit override rather than
 * silently send from a wrong or number-like sender.
 */
export function deriveAlphaSenderId(orgName: string): string | null {
  const stripped = orgName
    .normalize('NFKD')
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: strip combining marks
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, ALPHA_SENDER_ID_MAX_LENGTH);

  return isValidAlphaSenderId(stripped) ? stripped : null;
}
