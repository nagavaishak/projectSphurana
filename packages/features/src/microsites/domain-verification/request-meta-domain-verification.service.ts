/**
 * Contract §4 — Meta domain verification + Aggregated Event Measurement after
 * a host change.
 *
 * This is the step that degrades SILENTLY. Once a site moves to `salon.com`,
 * the pixel fires on a domain nobody has verified in Business Manager, AEM has
 * no event priority configured for it, and iOS conversions stop being
 * attributed. Nothing errors. Spend keeps going out. The first signal is a
 * month of flat reported conversions.
 *
 * TWO HALVES, and only one of them is automatable:
 *
 *   - DOMAIN VERIFICATION is now done for the tenant, by us, through
 *     `ensureMetaDomainVerification` — we claim the domain on the business's
 *     `owned_domains` edge and serve Meta's token as a meta tag from the page
 *     we render. Zero customer involvement, which is the whole advantage of
 *     hosting their site. A human is emailed only for the cases no retry can
 *     fix, and that email comes from THAT service, naming the specific cause.
 *   - AEM (Aggregated Event Measurement) has no reliable API — plan §11 lists
 *     it as a provisioning runbook item, deliberately not a pretend-automated
 *     step. So the email below still goes out, but it now asks for the one
 *     thing that genuinely needs hands.
 *
 * Log level tracks that split: `error` (the alert rule's hook) only when
 * verification itself needs a person; `warn` for the AEM reminder, which is
 * expected on every host change.
 */

import { organization } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  type MetaVerificationOutcome,
  ensureMetaDomainVerification,
} from './meta-verification/index.js';
import { notifyOrgAdmins } from './notify-org-admins.js';

const logger = createLogger('MicrositeMetaDomainVerification');

export interface RequestMetaDomainVerificationInput {
  organizationId: string;
  /** The host that now serves the site and must be verified with Meta. */
  host: string;
}

/** The verification half, as a sentence the tenant can act on (or ignore). */
const verificationLine = (
  outcome: MetaVerificationOutcome,
  host: string
): string => {
  switch (outcome) {
    case 'verified':
      return `<p><strong>${host}</strong> is already verified in your Meta
        Business account — we did that for you, nothing to do.</p>`;
    case 'claimed':
    case 'already_owned':
      return `<p>We have registered <strong>${host}</strong> in your Meta
        Business account and published the verification tag on your site. Meta
        usually confirms it within a few minutes — you do not need to add any
        DNS records.</p>`;
    default:
      // The specific blocker (conflict / unverified business / permissions)
      // has its own email from `ensureMetaDomainVerification`, which names the
      // exact fix. Repeating a vague version of it here would just compete
      // with that one.
      return `<p>Verifying <strong>${host}</strong> with Meta needs a hand —
        see the separate email about it.</p>`;
  }
};

const body = (
  orgName: string,
  host: string,
  outcome: MetaVerificationOutcome
) => `
  <p>Your website now answers on <strong>${host}</strong>.</p>
  ${verificationLine(outcome, host)}
  <p><strong>One thing only you can do:</strong> re-configure
  <strong>Aggregated Event Measurement</strong> — Events Manager → Aggregated
  Event Measurement → configure web events for <code>${host}</code> and set
  your event priority again. Meta has no API for this, and until it is redone
  your iPhone conversions stay under-counted.</p>
  <p>Your ads have already been pointed at the new address automatically. This
  last step needs someone with access to ${orgName}'s Meta Business account.</p>
`;

const requestMetaDomainVerificationImpl = async (
  db: DbConnection,
  input: RequestMetaDomainVerificationInput
): Promise<Result<{ notified: number; outcome: MetaVerificationOutcome }>> => {
  const { organizationId, host } = input;
  if (!organizationId || !host) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  // The Graph call. It never throws and never fails this flow — a Meta outage
  // must not stop a domain activation, so a failure here becomes an outcome,
  // not an error.
  const ensured = await ensureMetaDomainVerification(db, {
    organizationId,
    host,
  });
  const outcome: MetaVerificationOutcome = ensured.success
    ? ensured.data.outcome
    : 'transient_failure';

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { name: true },
  });

  const needsHuman = ensured.success && ensured.data.needsHuman;
  const message = 'Meta setup owed after a microsite host change';
  if (needsHuman) {
    logger.error(message, { organizationId, host, outcome });
  } else {
    logger.warn(message, { organizationId, host, outcome });
  }

  const { sent } = await notifyOrgAdmins(db, {
    organizationId,
    subject: `Action needed: finish Meta setup for ${host}`,
    html: body(org?.name ?? 'your business', host, outcome),
  });

  return ok({ notified: sent, outcome });
};

export const requestMetaDomainVerification = (
  db: DbConnection,
  input: RequestMetaDomainVerificationInput
) =>
  trackedResult(
    'microsites.requestMetaDomainVerification',
    () => requestMetaDomainVerificationImpl(db, input),
    { properties: { organizationId: input.organizationId, host: input.host } }
  );
