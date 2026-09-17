/**
 * Contract §2 step 3–4 — poll one domain, and carry it to a terminal state.
 *
 * SAFE TO RUN TWICE, CONCURRENTLY. That is not a nice-to-have: the sweep is a
 * BullMQ repeatable job, BullMQ retries, and two API instances can both hold a
 * worker. Two mechanisms enforce it, and they are independent on purpose:
 *
 *   1. A Redis lock per domain (`SET NX PX`) — the cheap one. It stops the
 *      duplicate `provider.verify()` call and the duplicate email in the
 *      overwhelming majority of races.
 *   2. CONDITIONAL UPDATES — the real one. Every state transition is
 *      `UPDATE … WHERE id = ? AND status IN (<the states it may leave>)
 *      RETURNING id`, and the side effect (the give-up email, the
 *      `domain_changed` fan-out) happens ONLY for the worker whose update
 *      returned a row. A lock can be lost to a Redis failover or expire under
 *      a slow provider call; a conditional update cannot.
 *
 * The give-up at 7 days is a REAL terminal state — `error` plus a message a
 * human can act on — not a silent stop. A domain that quietly stops being
 * polled is a tenant who thinks their website is coming and finds out weeks
 * later that nothing was ever going to happen.
 */

import { microsite, micrositeDomain } from '@borradh-workspace/database';
// The provisioning adapter (contract §1). Imported by NAME from the
// integrations package that owns it, never re-implemented here — a second
// Vercel-shaped code path is exactly what the interface exists to prevent.
import type { DomainProvider } from '@borradh-workspace/integrations/domains';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { micrositeBaseDomains } from '../domains/index.js';
import { hasExhaustedVerification } from './backoff.js';
import { enqueueDomainChanged } from './domain-queue.js';
import {
  DOMAIN_LOCK_KEY,
  DOMAIN_LOCK_TTL_MS,
} from './domain-verification.constants.js';
import { bustMicrositeHostCache } from './host-cache.js';
import { ensureMetaDomainVerification } from './meta-verification/index.js';
import { notifyOrgAdmins } from './notify-org-admins.js';

const logger = createLogger('MicrositeDomainVerification');

/** States a domain may still be moved OUT of by this service. */
const NON_TERMINAL = ['pending_dns', 'verifying'] as const;

export type VerifyDomainOutcome =
  /** Another worker holds the lock; this run did nothing. */
  | 'locked'
  /** Already `active` / `error` / `removed` — nothing owed. */
  | 'terminal'
  /** Still not verified; will be polled again after the backoff. */
  | 'pending'
  /** Verified on this run, by this worker. */
  | 'activated'
  /** Verified, but another worker recorded the activation first. */
  | 'already_active'
  /** 7 days elapsed; moved to `error` by this worker. */
  | 'gave_up';

export interface VerifyMicrositeDomainOutput {
  domainId: string;
  outcome: VerifyDomainOutcome;
  /** Set when this run made the domain the site's primary host. */
  primaryChangedFrom?: string;
  primaryChangedTo?: string;
}

export interface VerifyMicrositeDomainDeps {
  provider: DomainProvider;
  /** Injected so the backoff and give-up boundaries are testable. */
  now?: Date;
  /**
   * The §4 fan-out enqueue. Injectable so a test can pin "a primary change
   * enqueues the ad rewrite" without mocking the queue module — under
   * `isolate: false` a module mock persists on the shared worker graph.
   */
  enqueue?: typeof enqueueDomainChanged;
}

/** The apex the free `{slug}.<apex>` address lives on — one definition, shared. */
const firstBaseDomain = (): string => micrositeBaseDomains()[0] ?? 'borradh.io';

/**
 * The provider's "is it live yet" answer, read defensively.
 *
 * `DomainStatus` is the adapter's type and will grow (Vercel's
 * `verified`/`misconfigured` pair today, a Cloudflare custom-hostname status
 * later). Reading it structurally keeps a shape change in the adapter from
 * turning into a false ACTIVATION here — the direction that matters, because
 * activating early serves a tenant's site on a hostname they do not yet own.
 */
export const providerSaysVerified = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  // ONLY the port's own `state === 'active'`.
  //
  // Deliberately not `verified`. The Vercel adapter found that ownership and
  // routing are two separate facts (`verified` on the domain, `misconfigured`
  // on /config) and a domain can be verified AND misconfigured — the window
  // after the TXT record lands but before the A record does. `verify()` reports
  // `verifying` there on purpose. Treating "verified" as "live" would promote
  // that domain to primary and point the tenant's customers at a hostname
  // serving nothing, on their brand, looking like our outage.
  return typeof record.state === 'string' && record.state === 'active';
};

/** `SET key token NX PX ttl`. Returns the token when we own the lock. */
const acquireLock = async (domainId: string): Promise<string | null> => {
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  try {
    const res = await getRedis().set(
      DOMAIN_LOCK_KEY(domainId),
      token,
      'PX',
      DOMAIN_LOCK_TTL_MS,
      'NX'
    );
    return res === 'OK' ? token : null;
  } catch (error) {
    // Redis down must not stop verification — the conditional updates below
    // are what actually guarantee single-execution of the side effects.
    logger.warn('Domain lock unavailable; relying on conditional updates', {
      domainId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return 'lockless';
  }
};

const releaseLock = async (domainId: string, token: string): Promise<void> => {
  if (token === 'lockless') return;
  try {
    const redis = getRedis();
    const current = await redis.get(DOMAIN_LOCK_KEY(domainId));
    if (current === token) await redis.del(DOMAIN_LOCK_KEY(domainId));
  } catch {
    // TTL will clear it.
  }
};

const giveUpMessage = (domain: string) =>
  `We could not verify ${domain} after 7 days of checking. The DNS records have not appeared. Check them at your registrar (A record for the apex to 76.76.21.21, CNAME for www to cname.vercel-dns.com), then add the domain again to restart verification. Your site stays live on its borradh.io address in the meantime.`;

const verifyMicrositeDomainImpl = async (
  db: DbConnection,
  input: { domainId: string },
  deps: VerifyMicrositeDomainDeps
): Promise<Result<VerifyMicrositeDomainOutput>> => {
  const { domainId } = input;
  const now = deps.now ?? new Date();

  if (!domainId) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  const token = await acquireLock(domainId);
  if (!token) return ok({ domainId, outcome: 'locked' });

  try {
    const row = await db.query.micrositeDomain.findFirst({
      where: eq(micrositeDomain.id, domainId),
    });
    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Domain not found'));
    }
    if (
      row.status === 'active' ||
      row.status === 'error' ||
      row.status === 'removed'
    ) {
      return ok({ domainId, outcome: 'terminal' });
    }

    const elapsed = now.getTime() - new Date(row.createdAt).getTime();

    // ── Terminal give-up ──────────────────────────────────────────────
    if (hasExhaustedVerification(elapsed)) {
      const [claimed] = await db
        .update(micrositeDomain)
        .set({
          status: 'error',
          errorMessage: giveUpMessage(row.domain),
          lastCheckedAt: now,
          verification: {
            ...(row.verification ?? {}),
            gaveUpAt: now.toISOString(),
          },
          updatedAt: now,
        })
        .where(
          and(
            eq(micrositeDomain.id, domainId),
            inArray(micrositeDomain.status, [...NON_TERMINAL])
          )
        )
        .returning({ id: micrositeDomain.id });

      // No row => a concurrent worker already gave up on it and already
      // emailed. Exactly one notice per domain, by construction.
      if (!claimed) return ok({ domainId, outcome: 'terminal' });

      await notifyOrgAdmins(db, {
        organizationId: row.organizationId,
        subject: `We couldn't connect ${row.domain}`,
        html: `<p>${giveUpMessage(row.domain)}</p>`,
      });
      await bustMicrositeHostCache([row.domain]);

      logger.error('Gave up verifying a microsite domain after 7 days', {
        domainId,
        organizationId: row.organizationId,
      });
      return ok({ domainId, outcome: 'gave_up' });
    }

    // ── Poll the provider ─────────────────────────────────────────────
    const verified = await deps.provider.verify(row.domain);

    if (!verified.success || !providerSaysVerified(verified.data)) {
      // Carry the provider's own explanation onto the row so the tenant's
      // status screen can say WHICH record is still missing. `DomainStatus`
      // documents `message`/`records` as tenant-safe: no credentials, no raw
      // payloads. Nothing else from the provider is ever persisted.
      const snapshot = verified.success ? verified.data : null;
      await db
        .update(micrositeDomain)
        .set({
          status: 'verifying',
          lastCheckedAt: now,
          errorMessage: snapshot?.message ?? null,
          verification: snapshot
            ? {
                ...(row.verification ?? {}),
                records: snapshot.records,
                providerRef:
                  snapshot.providerRef ?? row.verification?.providerRef,
              }
            : (row.verification ?? {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(micrositeDomain.id, domainId),
            inArray(micrositeDomain.status, [...NON_TERMINAL])
          )
        );
      return ok({ domainId, outcome: 'pending' });
    }

    // ── Activate ──────────────────────────────────────────────────────
    const [activated] = await db
      .update(micrositeDomain)
      .set({
        status: 'active',
        errorMessage: null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(micrositeDomain.id, domainId),
          inArray(micrositeDomain.status, [...NON_TERMINAL])
        )
      )
      .returning({ id: micrositeDomain.id });

    if (!activated) {
      // Another worker activated it and owns the domain_changed fan-out.
      return ok({ domainId, outcome: 'already_active' });
    }

    const site = await db.query.microsite.findFirst({
      where: eq(microsite.id, row.micrositeId),
      columns: { slug: true },
    });
    const fallbackHost = `${site?.slug ?? ''}.${firstBaseDomain()}`;

    const existingPrimary = (await db.query.micrositeDomain.findFirst({
      where: and(
        eq(micrositeDomain.micrositeId, row.micrositeId),
        eq(micrositeDomain.isPrimary, true),
        ne(micrositeDomain.id, domainId)
      ),
      columns: { id: true, domain: true },
    })) as { id: string; domain: string } | undefined;

    // `www.` is provisioned as the pair of an apex, never as the canonical
    // host — making it primary would put every ad and booking link on the
    // redirecting half of the pair.
    const isWww = row.domain.startsWith('www.');
    const shouldBecomePrimary = !isWww && !existingPrimary;

    await bustMicrositeHostCache([
      row.domain,
      existingPrimary?.domain,
      fallbackHost,
    ]);

    // EVERY activation, not just the ones that become primary. Plan §7 is
    // explicit that a domain change silently invalidates the previous Meta
    // verification, and a non-primary host (the `www.` half of a pair, a
    // second brand domain) still serves the pixel — an unverified one there
    // under-counts exactly the same. Awaited rather than fired-and-forgotten
    // because the row is already `active` at this point: the transition has
    // been recorded and cannot be undone by this call, which returns an
    // outcome rather than throwing.
    await ensureMetaDomainVerification(db, {
      organizationId: row.organizationId,
      host: row.domain,
    });

    if (!shouldBecomePrimary) {
      return ok({ domainId, outcome: 'activated' });
    }

    const [flipped] = await db
      .update(micrositeDomain)
      .set({ isPrimary: true, updatedAt: now })
      .where(
        and(
          eq(micrositeDomain.id, domainId),
          eq(micrositeDomain.isPrimary, false)
        )
      )
      .returning({ id: micrositeDomain.id });

    // Only the worker that actually performed the flip fans out §4.
    if (!flipped) return ok({ domainId, outcome: 'activated' });

    // We only reach the flip when the site had NO primary yet, so the host the
    // world currently knows is the `{slug}.borradh.io` fallback. Replacing an
    // existing primary is the deliberate, human path and goes through
    // `changePrimaryDomain`, which computes its own previous host.
    const previousHost = fallbackHost;

    await (deps.enqueue ?? enqueueDomainChanged)({
      micrositeId: row.micrositeId,
      organizationId: row.organizationId,
      domainId,
      previousHost,
      newHost: row.domain,
    });

    logger.info('Microsite domain activated and made primary', {
      domainId,
      micrositeId: row.micrositeId,
      previousHost,
      newHost: row.domain,
    });

    return ok({
      domainId,
      outcome: 'activated',
      primaryChangedFrom: previousHost,
      primaryChangedTo: row.domain,
    });
  } finally {
    await releaseLock(domainId, token);
  }
};

export const verifyMicrositeDomain = (
  db: DbConnection,
  input: { domainId: string },
  deps: VerifyMicrositeDomainDeps
) =>
  trackedResult(
    'microsites.verifyMicrositeDomain',
    () => verifyMicrositeDomainImpl(db, input, deps),
    { properties: { domainId: input.domainId } }
  );
