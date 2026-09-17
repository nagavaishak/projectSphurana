/**
 * Server-side email hygiene checks that run BEFORE account creation and the
 * verification-email send.
 *
 * Motivation: automated bot signups were flooding the sign-up endpoint with
 * syntactically-junk and disposable-domain addresses. Every one of those hit
 * account creation and then the Resend verification email, producing thousands
 * of "Invalid `to` field" / "400 Invalid email address" failures per day,
 * burning Resend quota and drowning real signup metrics.
 *
 * Zod's `.email()` is deliberately permissive (it accepts things Resend then
 * rejects, e.g. no TLD, leading/trailing dots, consecutive dots). These checks
 * are the last cheap gate before we spend an account row + an email send.
 *
 * Pure, dependency-free — safe to unit test and to run in any environment.
 */

/**
 * Known disposable / throwaway email domains. This is a curated subset of the
 * most common providers seen in the bot flood — not exhaustive, but covers the
 * overwhelming majority of abusive signups. Kept lowercase; lookups normalize.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'byom.de',
  'cool.fr.nf',
  'courriel.fr.nf',
  'dispostable.com',
  'disposemail.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'fakemailgenerator.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'jetable.org',
  'mail-temp.com',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'maileater.com',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mailnull.com',
  'maildrop.co',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'mytrashmail.com',
  'nada.email',
  'no-spam.ws',
  'nowmymail.com',
  'objectmail.com',
  'oneoffemail.com',
  'onewaymail.com',
  'proxymail.eu',
  'rcpt.at',
  'sharklasers.com',
  'shitmail.me',
  'sogetthis.com',
  'spam4.me',
  'spamavert.com',
  'spambog.com',
  'spamgourmet.com',
  'spamherelots.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailaddress.com',
  'tempmailo.com',
  'tempomail.fr',
  'temporarymail.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'trbvm.com',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/**
 * A strict-but-reasonable email format check. Intentionally tighter than
 * zod's `.email()`: it rejects the malformed shapes Resend bounces on
 * (missing/invalid TLD, leading/trailing/consecutive dots in the local part
 * or domain, illegal characters). It is not a full RFC 5322 parser — it errs
 * toward rejecting deliverability-hostile addresses, which is exactly what we
 * want at the signup gate.
 */
export function isDeliverableEmailFormat(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  // Overall length sanity (RFC caps at 254 for the whole address).
  if (trimmed.length === 0 || trimmed.length > 254) return false;

  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return false;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Local part: 1-64 chars, allowed atext, no leading/trailing/consecutive dots.
  if (local.length === 0 || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;

  // Domain: valid labels + a real alphabetic TLD (>= 2 chars).
  if (domain.length === 0 || domain.length > 253) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return false;

  return true;
}

/** Extract the lowercased domain from an email, or null if it has none. */
export function getEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 0 || atIndex === email.length - 1) return null;
  return email
    .slice(atIndex + 1)
    .trim()
    .toLowerCase();
}

/** True if the email's domain is a known disposable/throwaway provider. */
export function isDisposableEmail(email: string): boolean {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

export type EmailRejectionReason = 'invalid_format' | 'disposable_domain';

/**
 * Run the full signup email gate. Returns a rejection reason string when the
 * email should be blocked before account creation, or `null` when it passes.
 */
export function checkSignupEmail(email: string): EmailRejectionReason | null {
  if (!isDeliverableEmailFormat(email)) return 'invalid_format';
  if (isDisposableEmail(email)) return 'disposable_domain';
  return null;
}
