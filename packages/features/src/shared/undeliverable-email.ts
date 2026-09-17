/**
 * DUPLICATED, deliberately, in packages/email/src/undeliverable-email.ts.
 *
 * `packages/email` reads RESEND_API_KEY at module load, so importing it from
 * `packages/features/shared` to share this would drag that side effect into
 * every consumer — the same thing that broke the API jest suite when the
 * organizations barrel was imported into testing.service. The list is
 * RFC-defined and does not change; keep the two in sync.
 *
 * Addresses that can NEVER receive mail, so we should never try.
 *
 * `example.com`/`.net`/`.org` and `.test`/`.invalid`/`.example` are reserved by
 * RFC 2606 / RFC 6761 precisely so they cannot resolve. Our E2E suite uses them
 * for every provisioned user, and both providers reject them:
 *
 *   - Loops  → `APIError: 400 - Invalid email address.`   (~3.4k Sentry events)
 *   - Resend → `Failed to send email: Invalid \`to\` field. Please use our
 *              testing email address instead of domains like example.com`
 *              (~1k events across appointments, invitations, team-member and
 *              public-booking cancel)
 *
 * That is ~4.5k errors reporting a send that was never possible, drowning real
 * failures. Skipping them is not suppression: there is no delivery to attempt.
 *
 * A genuinely bad address at a real domain still errors, as it should.
 */
const RESERVED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
]);

const RESERVED_EMAIL_TLDS = ['.test', '.invalid', '.example', '.localhost'];

export function isUndeliverableEmail(
  email: string | null | undefined
): boolean {
  if (!email) return true;
  const at = email.lastIndexOf('@');
  if (at === -1) return true;
  const domain = email.slice(at + 1).toLowerCase();
  if (RESERVED_EMAIL_DOMAINS.has(domain)) return true;
  return RESERVED_EMAIL_TLDS.some((tld) => domain.endsWith(tld));
}
