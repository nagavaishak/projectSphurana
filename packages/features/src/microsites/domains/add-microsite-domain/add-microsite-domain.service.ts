/**
 * Attach a custom domain to a microsite (plan §2.1).
 *
 * The order of operations is the interesting part:
 *
 *   1. VALIDATE the name (`validateMicrositeDomain`) — including the refusal to
 *      let a tenant claim one of our own apexes, which would let them jump the
 *      wildcard tier for another org.
 *   2. AUTHORIZE by WHERE clause (`loadOwnedMicrosite`). A cross-org
 *      `micrositeId` is NOT_FOUND, never FORBIDDEN: FORBIDDEN would confirm the
 *      id exists, which is a membership oracle over every tenant's site.
 *   3. CLAIM the row FIRST, then call the provider. `microsite_domain.domain`
 *      carries a global UNIQUE constraint, so the database — not a racing
 *      read — is what decides who gets a contested hostname. Calling the
 *      provider first would attach the domain to our Vercel project on behalf
 *      of an org that then loses the insert.
 *   4. PROVISION the apex AND the `www` sibling. The apex is fatal; the alias is
 *      not — a site that resolves on `salon.com` but not `www.salon.com` is
 *      degraded, whereas failing the whole call leaves the tenant with nothing
 *      and a row they have to delete before retrying.
 *
 * IDEMPOTENT by contract. This is called from a UI button and, on failure,
 * retried; and `provider.add` is itself idempotent. Re-adding a domain this
 * microsite already holds re-runs provisioning and returns the same row rather
 * than erroring, so a tenant who clicks twice, or a retry after a provider
 * timeout, converges instead of dead-ending.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { isUniqueViolation } from '@borradh-workspace/database';
import type {
  DomainDnsRecord,
  DomainProvider,
} from '@borradh-workspace/integrations/domains';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadOwnedMicrosite } from '../../services/shared/index.js';
import {
  type DomainInstructions,
  buildDomainInstructions,
} from '../dns-instructions.js';
import { domainPairFor, validateMicrositeDomain } from '../domain-name.js';
import { toDomainFeatureError } from '../provider-errors.js';
import { type NameserverResolver, detectRegistrar } from '../registrar.js';
import {
  type AddMicrositeDomainInput,
  addMicrositeDomainSchema,
} from './add-microsite-domain.schema.js';

/** Injected so tests never touch the network and the provider stays swappable. */
export interface DomainServiceDeps {
  provider: DomainProvider;
  /** Overridden in tests; production uses the real NS lookup. */
  resolveNameservers?: NameserverResolver;
}

export interface AddMicrositeDomainOutput {
  id: string;
  micrositeId: string;
  organizationId: string;
  domain: string;
  status: 'pending_dns' | 'verifying' | 'active' | 'error';
  isPrimary: boolean;
  /** False when an existing row for this domain was returned instead. */
  created: boolean;
  /** What to tell the tenant to type, and where to type it. */
  instructions: DomainInstructions;
}

const addMicrositeDomainImpl = async (
  db: DbConnection,
  input: AddMicrositeDomainInput,
  deps: DomainServiceDeps
): Promise<Result<AddMicrositeDomainOutput>> => {
  const parsed = addMicrositeDomainSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId } = parsed.data;

  const validated = validateMicrositeDomain(parsed.data.domain);
  if (!validated.valid) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, validated.message, {
        reason: validated.reason,
      })
    );
  }

  const { canonical, alias } = domainPairFor(validated.value);

  const owned = await loadOwnedMicrosite(db, micrositeId, organizationId);
  if (!owned.success) return err(owned.error);

  // ── Claim the row ────────────────────────────────────────────────
  let row: {
    id: string;
    micrositeId: string;
    status: string;
    isPrimary: boolean;
  } | null = null;
  let created = false;

  const existing = await db.query.micrositeDomain.findFirst({
    where: eq(micrositeDomain.domain, canonical),
    columns: {
      id: true,
      micrositeId: true,
      organizationId: true,
      status: true,
      isPrimary: true,
    },
  });

  if (existing) {
    // One domain, one tenant — the schema's global UNIQUE says so. Surface the
    // clash as a CONFLICT with a message a human can act on, rather than the
    // 500 an unhandled unique violation would produce.
    if (existing.micrositeId !== micrositeId) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'That domain is already connected to another account',
          { domain: canonical }
        )
      );
    }
    row = existing;
    // A `removed` row is a tombstone we never reuse for a DIFFERENT tenant, but
    // the SAME tenant re-adding their own domain is a revival, not a new claim.
    if (existing.status === 'removed') {
      await db
        .update(micrositeDomain)
        .set({ status: 'pending_dns', errorMessage: null })
        .where(eq(micrositeDomain.id, existing.id));
      row = { ...existing, status: 'pending_dns' };
    }
  } else {
    try {
      const [inserted] = await db
        .insert(micrositeDomain)
        .values({
          micrositeId,
          organizationId,
          domain: canonical,
          status: 'pending_dns',
          isPrimary: false,
        })
        .returning({
          id: micrositeDomain.id,
          micrositeId: micrositeDomain.micrositeId,
          status: micrositeDomain.status,
          isPrimary: micrositeDomain.isPrimary,
        });
      row = inserted ?? null;
      created = true;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        logError('microsites.addMicrositeDomain', error, {
          feature: 'microsites',
          extra: { micrositeId, organizationId, domain: canonical },
        });
        return err(
          new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add domain')
        );
      }
      // Lost the race. Re-read and let the winner decide the answer.
      const winner = await db.query.micrositeDomain.findFirst({
        where: eq(micrositeDomain.domain, canonical),
        columns: {
          id: true,
          micrositeId: true,
          organizationId: true,
          status: true,
          isPrimary: true,
        },
      });
      if (!winner || winner.micrositeId !== micrositeId) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'That domain is already connected to another account',
            { domain: canonical }
          )
        );
      }
      row = winner;
    }
  }

  if (!row) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add domain')
    );
  }

  // ── Provision ────────────────────────────────────────────────────
  const apexAdd = await deps.provider.add(canonical);
  if (!apexAdd.success) {
    const featureError = toDomainFeatureError(apexAdd.error);
    // Record WHY, so the UI can show it and the poller does not keep retrying a
    // domain the provider will never accept.
    await db
      .update(micrositeDomain)
      .set({ status: 'error', errorMessage: featureError.message })
      .where(eq(micrositeDomain.id, row.id));
    return err(featureError);
  }

  const records: DomainDnsRecord[] = [...apexAdd.data.records];

  if (alias) {
    const aliasAdd = await deps.provider.add(alias);
    if (aliasAdd.success) {
      records.push(...aliasAdd.data.records);
    } else {
      // Non-fatal on purpose — see the file header. The verification job retries
      // the pair, so a transient provider failure here self-heals.
      logError('microsites.addMicrositeDomain.alias', aliasAdd.error, {
        feature: 'microsites',
        extra: { micrositeId, domain: alias, code: aliasAdd.error.code },
      });
    }
  }

  const registrar = await detectRegistrar(canonical, deps.resolveNameservers);
  const instructions = buildDomainInstructions({
    domain: canonical,
    alias,
    records,
    registrar,
  });

  // `verification` is typed OPEN (`MicrositeDomainVerification`) so a provider
  // swap is not a data migration. Only neutral shapes go in — records, an
  // opaque providerRef, and our own alias bookkeeping. No Vercel-shaped field
  // has any business here.
  await db
    .update(micrositeDomain)
    .set({
      verification: {
        records: instructions.records.map((r) => ({
          type: r.type,
          name: r.name,
          value: r.value,
        })),
        ...(apexAdd.data.providerRef
          ? { providerRef: apexAdd.data.providerRef }
          : {}),
        alias,
        registrarId: registrar.id,
      },
      errorMessage: null,
      lastCheckedAt: new Date(),
    })
    .where(
      and(
        eq(micrositeDomain.id, row.id),
        eq(micrositeDomain.organizationId, organizationId)
      )
    );

  return ok({
    id: row.id,
    micrositeId,
    organizationId,
    domain: canonical,
    status: 'pending_dns',
    isPrimary: row.isPrimary,
    created,
    instructions,
  });
};

export const addMicrositeDomain = (
  db: DbConnection,
  input: AddMicrositeDomainInput,
  deps: DomainServiceDeps
) =>
  trackedResult(
    'microsites.addMicrositeDomain',
    () => addMicrositeDomainImpl(db, input, deps),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
        domain: input.domain,
      },
    }
  );

export type AddMicrositeDomainResult = Awaited<
  ReturnType<typeof addMicrositeDomain>
>;
