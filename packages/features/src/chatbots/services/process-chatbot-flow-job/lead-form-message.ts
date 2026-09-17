/**
 * Detect Meta lead-form / instant-form auto-fill messages (prod-bug follow-up).
 *
 * A Click-to-Messenger (or CTWA) ad with an instant form delivers the answers
 * as a chat message like:
 *
 *   "Hello! I filled out your form and would like to know more about your
 *    business.
 *    Email: sarah@example.com
 *    Full name: Sarah Ricketts
 *    How interested are you in our Fat Loss Red Light Therapy?: Very Interested
 *    Phone number: (909) 273-9541"
 *
 * These are ALWAYS genuine leads, but the verbose template ("...about your
 * business" + a name/email/phone dump) can trip the AI classifier's B2B /
 * personal buckets → `silent_handoff` (no reply). This helper lets the flow
 * processor recognise the pattern deterministically and guarantee a reply.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const INTEREST_RE = /how interested are you in (?:our |your |the )?([^?:\n]+)/i;
const FULL_NAME_RE = /\bfull name\s*[:=]/i;

const FORM_FILL_PHRASES = [
  /\bfilled (?:out|in) (?:your|the|our|my) form\b/i,
  /\bsubmitted (?:your|the|our|my) form\b/i,
  /\bcompleted (?:your|the|our|my) form\b/i,
  /\bjust filled (?:out|in) (?:a |the |your )?form\b/i,
];

/**
 * True when the message is a lead-form / instant-form submission — either it
 * explicitly says so, OR it carries the structured contact dump (email +
 * phone + an interest/full-name line) Meta forms produce.
 */
export function isLeadFormMessage(text: string | undefined | null): boolean {
  if (!text) return false;
  if (FORM_FILL_PHRASES.some((re) => re.test(text))) return true;

  const hasEmail = EMAIL_RE.test(text);
  const hasPhone = PHONE_RE.test(text);
  const hasFormStructure = INTEREST_RE.test(text) || FULL_NAME_RE.test(text);
  return hasEmail && hasPhone && hasFormStructure;
}

/**
 * Pull the service the lead is interested in from the form's interest line
 * ("How interested are you in our <Service>?"). Returns null when absent —
 * callers fall back to the ad title or a generic opener.
 */
export function extractFormService(
  text: string | undefined | null
): string | null {
  if (!text) return null;
  const match = text.match(INTEREST_RE);
  const service = match?.[1]?.trim();
  return service && service.length > 0 ? service : null;
}
