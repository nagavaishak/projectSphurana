/**
 * Claim the host with Meta and keep its verification token where the renderer
 * can serve it (plan §11, "Domain verification").
 *
 * WHY THIS IS AUTOMATED AT ALL. Without a verified domain, Meta will not
 * attribute iOS conversions to a pixel firing on it, and Aggregated Event
 * Measurement cannot be configured for it. On a normal customer website the
 * fix is a support ticket — DNS TXT record, copy, paste, wait. Because WE
 * render the page, we can claim the domain on the tenant's behalf and emit
 * `<meta name="facebook-domain-verify">` ourselves, and the customer does
 * nothing at all. That is a real advantage of hosting the site, and it only
 * exists if this whole path is automatic.
 *
 * THREE PROPERTIES THIS SERVICE MUST HAVE, all of them load-bearing:
 *
 *   1. IDEMPOTENT. Both trigger points (publish, and every custom-domain
 *      activation) can fire for the same host, repeatedly. A domain the
 *      business already owns is SUCCESS. The client reads before it claims for
 *      exactly this reason.
 *   2. NEVER FATAL. Meta being down must not fail a domain activation or a
 *      publish. Every failure here returns `ok(...)` with an outcome; only a
 *      malformed input is an error.
 *   3. LOUD ONLY WHEN A HUMAN IS NEEDED. A conflict (the domain is claimed in
 *      someone else's Business Manager) and an unverified Business Manager are
 *      permanent until a person acts, and they need DIFFERENT actions. A Meta
 *      500 is neither — it must not email anyone. `NEEDS_HUMAN` is that line,
 *      and the notice is deduped on the outcome so seven days of polling
 *      produce one email, not two thousand.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import {
  MetaOwnedDomainError,
  MetaOwnedDomainsService,
  fetchAdAccountBusinessId,
} from '@borradh-workspace/integrations/meta-domains';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { getMetaCredentials } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { micrositeBaseDomains } from '../../domains/index.js';
import { notifyOrgAdmins } from '../notify-org-admins.js';
import { humanActionEmail } from './meta-verification.emails.js';
import {
  META_VERIFICATION_KEY,
  type MetaDomainVerificationState,
  type MetaVerificationOutcome,
  NEEDS_HUMAN,
} from './meta-verification.types.js';

const logger = createLogger('MicrositeMetaDomainVerification');

export interface EnsureMetaDomainVerificationInput {
  organizationId: string;
  /** The host that should be verified — a custom domain, not a path. */
  host: string;
}

export interface EnsureMetaDomainVerificationOutput {
  host: string;
  outcome: MetaVerificationOutcome;
  /** True when only a person can move this forward. */
  needsHuman: boolean;
  /**
   * Whether a token is now stored for the renderer. The token itself is
   * deliberately NOT returned: it would end up in a log line the first time
   * someone debugged this flow.
   */
  tokenStored: boolean;
  /** Whether this call sent the human-action email (deduped). */
  notified: boolean;
}

const normalizeHost = (host: string): string =>
  host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');

/**
 * `{slug}.borradh.io` belongs to US, and Meta allows exactly one owning
 * business per domain — so a tenant's Business Manager can never claim it.
 * Verification on the shared apex is ours to hold; the tenant's own domain is
 * the only one this flow can automate. Saying so explicitly beats a
 * mysterious permanent conflict on every org that has not bought a domain yet.
 */
const isSharedApex = (host: string): boolean =>
  micrositeBaseDomains().some(
    (base) => host === base || host.endsWith(`.${base}`)
  );

/** The persisted slice, read defensively — the jsonb is open-ended by design. */
const readState = (
  verification: unknown
): MetaDomainVerificationState | undefined => {
  if (!verification || typeof verification !== 'object') return undefined;
  const slice = (verification as Record<string, unknown>)[
    META_VERIFICATION_KEY
  ];
  return slice && typeof slice === 'object'
    ? (slice as MetaDomainVerificationState)
    : undefined;
};

const outcomeFromMetaStatus = (
  status: string | undefined,
  fallback: MetaVerificationOutcome
): MetaVerificationOutcome =>
  status?.toUpperCase() === 'VERIFIED' ? 'verified' : fallback;

const ensureMetaDomainVerificationImpl = async (
  db: DbConnection,
  input: EnsureMetaDomainVerificationInput
): Promise<Result<EnsureMetaDomainVerificationOutput>> => {
  const { organizationId } = input;
  if (!organizationId || !input.host) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  const host = normalizeHost(input.host);

  const skip = (
    outcome: MetaVerificationOutcome
  ): Result<EnsureMetaDomainVerificationOutput> =>
    ok({
      host,
      outcome,
      needsHuman: false,
      tokenStored: false,
      notified: false,
    });

  if (isSharedApex(host)) return skip('shared_apex');

  // The domain row is both the authorization boundary (it carries the org) and
  // the only place a token can live where the renderer will find it. No row,
  // nothing to do — and that is the normal state for a publish on the free
  // tier, so it is not a warning.
  const row = await db.query.micrositeDomain.findFirst({
    where: eq(micrositeDomain.domain, host),
  });
  if (!row || row.organizationId !== organizationId)
    return skip('unknown_host');

  const credResult = await getMetaCredentials(db, {
    organizationId,
    requireConfigured: false,
    operationName: 'microsites.ensureMetaDomainVerification',
  });
  if (!credResult.success) return skip('meta_not_configured');

  const { credentials, integration } = credResult.data;

  // Business id: the integration's cached list first (free), Meta second
  // (authoritative). `available_ad_accounts` is cleared once setup completes on
  // some connection shapes, which is exactly why there is a live fallback.
  // `businessId` is present on the stored `MetaAdAccountInfo` shape but is not
  // surfaced on the credential resolver's narrower return type, so it is read
  // structurally rather than by widening a shared type this flow does not own.
  const cached = integration.availableAdAccounts?.find(
    (account) =>
      account?.id === credentials.adAccountId ||
      account?.accountId === credentials.adAccountId
  ) as { businessId?: string } | undefined;

  let businessId = cached?.businessId ?? undefined;
  if (!businessId) {
    try {
      businessId =
        (await fetchAdAccountBusinessId({
          accessToken: credentials.accessToken,
          adAccountId: credentials.adAccountId,
          appSecret: credentials.appSecret,
        })) ?? undefined;
    } catch (error) {
      return finish(db, row, host, classify(error), undefined);
    }
  }

  // An ad account with no business behind it is a personal ad account. It has
  // no owned_domains edge at all, and the tenant has to create a Business
  // Manager before any of this is possible.
  if (!businessId) return finish(db, row, host, 'permission_denied', undefined);

  const client = new MetaOwnedDomainsService({
    accessToken: credentials.accessToken,
    businessId,
    appSecret: credentials.appSecret,
  });

  try {
    const { outcome, ownedDomain } = await client.claimDomain(host);
    const resolved: MetaVerificationOutcome = ownedDomain.verificationToken
      ? outcomeFromMetaStatus(
          ownedDomain.verificationStatus,
          outcome === 'claimed' ? 'claimed' : 'already_owned'
        )
      : // Owned, but with no code to serve, we cannot finish this ourselves.
        outcomeFromMetaStatus(
          ownedDomain.verificationStatus,
          'token_unavailable'
        );

    return finish(db, row, host, resolved, {
      businessId,
      ownedDomainId: ownedDomain.id,
      token: ownedDomain.verificationToken,
      metaStatus: ownedDomain.verificationStatus,
    });
  } catch (error) {
    return finish(db, row, host, classify(error), { businessId });
  }
};

const classify = (error: unknown): MetaVerificationOutcome => {
  if (error instanceof MetaOwnedDomainError) {
    switch (error.reason) {
      case 'already_owned_elsewhere':
        return 'conflict';
      case 'business_not_verified':
        return 'business_unverified';
      case 'permission_denied':
        return 'permission_denied';
      default:
        return 'transient_failure';
    }
  }
  return 'transient_failure';
};

/**
 * Persist the outcome, and tell a human ONLY when a human is the only way
 * forward — once per distinct reason, not once per poll.
 */
const finish = async (
  db: DbConnection,
  row: {
    id: string;
    domain: string;
    organizationId: string;
    verification?: unknown;
  },
  host: string,
  outcome: MetaVerificationOutcome,
  details:
    | Pick<
        MetaDomainVerificationState,
        'businessId' | 'ownedDomainId' | 'token' | 'metaStatus'
      >
    | undefined
): Promise<Result<EnsureMetaDomainVerificationOutput>> => {
  const previous = readState(row.verification);
  const needsHuman = NEEDS_HUMAN.has(outcome);
  const alreadyNotified = previous?.notifiedOutcome === outcome;
  const shouldNotify = needsHuman && !alreadyNotified;

  // A transient failure must not erase a token we already hold — the renderer
  // keeps serving the tag while Meta is having a bad afternoon.
  const token = details?.token ?? previous?.token;

  const state: MetaDomainVerificationState = {
    outcome,
    businessId: details?.businessId ?? previous?.businessId,
    ownedDomainId: details?.ownedDomainId ?? previous?.ownedDomainId,
    token,
    metaStatus: details?.metaStatus ?? previous?.metaStatus,
    checkedAt: new Date().toISOString(),
    notifiedOutcome: shouldNotify ? outcome : previous?.notifiedOutcome,
    notifiedAt: shouldNotify ? new Date().toISOString() : previous?.notifiedAt,
  };

  const existing =
    row.verification && typeof row.verification === 'object'
      ? (row.verification as Record<string, unknown>)
      : {};

  await db
    .update(micrositeDomain)
    .set({ verification: { ...existing, [META_VERIFICATION_KEY]: state } })
    .where(eq(micrositeDomain.id, row.id));

  let notified = false;
  if (shouldNotify) {
    // Error level on purpose: a domain that cannot be verified is a revenue
    // defect, and this is the alert rule's hook. Transient failures stay at
    // warn so a Meta outage does not page anyone.
    logger.error('Meta domain verification needs a human', {
      organizationId: row.organizationId,
      host,
      outcome,
    });
    const email = humanActionEmail(outcome, host);
    if (email) {
      const { sent } = await notifyOrgAdmins(db, {
        organizationId: row.organizationId,
        subject: email.subject,
        html: email.html,
      });
      notified = sent > 0;
    }
  } else if (outcome === 'transient_failure') {
    logger.warn('Meta domain verification will be retried', {
      organizationId: row.organizationId,
      host,
    });
  } else {
    logger.info('Meta domain verification state', {
      organizationId: row.organizationId,
      host,
      outcome,
    });
  }

  return ok({
    host,
    outcome,
    needsHuman,
    tokenStored: Boolean(token),
    notified,
  });
};

export const ensureMetaDomainVerification = (
  db: DbConnection,
  input: EnsureMetaDomainVerificationInput
) =>
  trackedResult(
    'microsites.ensureMetaDomainVerification',
    () => ensureMetaDomainVerificationImpl(db, input),
    { properties: { organizationId: input.organizationId, host: input.host } }
  );

export type EnsureMetaDomainVerificationResult = Awaited<
  ReturnType<typeof ensureMetaDomainVerification>
>;
