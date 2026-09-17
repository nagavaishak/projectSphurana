import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type MockDb,
  createMockDb,
  uniqueViolation,
} from '../../services/shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
  micrositeRow,
} from '../../services/shared/test-fixtures.test-utils.js';
import {
  type FakeProvider,
  createFakeProvider,
  providerFailure,
} from '../fake-provider.test-utils.js';
import { addMicrositeDomain } from './add-microsite-domain.service.js';

let db: MockDb;
let provider: FakeProvider;

/** Every registrar lookup in this file is answered here, never by DNS. */
const resolveNameservers = vi.fn(async () => ['ns1.domaincontrol.com']);

const deps = () => ({ provider, resolveNameservers });

const base = {
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  domain: 'salon.com',
};

const DOMAIN_ROW = {
  id: 'dom-1',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  status: 'pending_dns',
  isPrimary: false,
};

describe('addMicrositeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveNameservers.mockResolvedValue(['ns1.domaincontrol.com']);
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);
    db.insertReturning.mockResolvedValue([DOMAIN_ROW]);
    provider = createFakeProvider();
  });

  it('claims the row, provisions the apex AND the www sibling, and returns instructions', async () => {
    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.domain).toBe('salon.com');
    expect(result.data.created).toBe(true);
    expect(result.data.status).toBe('pending_dns');

    // The pair, not just the apex (plan §2.1).
    expect(provider.add).toHaveBeenCalledTimes(2);
    expect(provider.add).toHaveBeenNthCalledWith(1, 'salon.com');
    expect(provider.add).toHaveBeenNthCalledWith(2, 'www.salon.com');

    // Registrar deep link — the support-load killer (plan §2.2).
    expect(result.data.instructions.registrar.id).toBe('godaddy');
    expect(result.data.instructions.registrar.dnsSettingsUrl).toContain(
      'salon.com'
    );
    // Routing records sort before challenges.
    expect(result.data.instructions.records[0]?.purpose).toBe('routing');
  });

  it('writes only neutral shapes into verification', async () => {
    await addMicrositeDomain(db as never, base, deps());

    const verificationSet = db.set.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((patch) => 'verification' in patch);

    expect(verificationSet).toBeDefined();
    const serialized = JSON.stringify(verificationSet);
    // A provider name in this column would make the Cloudflare swap a data
    // migration — the one thing the port exists to prevent.
    expect(serialized.toLowerCase()).not.toContain('vercel');
    expect(
      (verificationSet as { verification: { records: unknown[] } }).verification
        .records.length
    ).toBeGreaterThan(0);
  });

  it('normalises before claiming, so www.SALON.com/ books the apex row', async () => {
    await addMicrositeDomain(
      db as never,
      { ...base, domain: 'HTTPS://www.SALON.com/pricing' },
      deps()
    );

    expect((db.values.mock.calls[0]?.[0] as { domain: string }).domain).toBe(
      'salon.com'
    );
  });

  // ── Authorization ────────────────────────────────────────────────
  it('returns NOT_FOUND (never FORBIDDEN) for a cross-org microsite', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await addMicrositeDomain(
      db as never,
      { ...base, organizationId: OTHER_ORG_ID },
      deps()
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(provider.add).not.toHaveBeenCalled();
  });

  // ── Validation ───────────────────────────────────────────────────
  it('refuses our own apex without touching the provider', async () => {
    const result = await addMicrositeDomain(
      db as never,
      { ...base, domain: 'acme.borradh.io' },
      deps()
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.details?.reason).toBe('own_apex');
    expect(db.insert).not.toHaveBeenCalled();
    expect(provider.add).not.toHaveBeenCalled();
  });

  it('refuses an IP address', async () => {
    const result = await addMicrositeDomain(
      db as never,
      { ...base, domain: '76.76.21.21' },
      deps()
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.details?.reason).toBe('ip_address');
  });

  // ── One domain, one tenant ───────────────────────────────────────
  it('surfaces a domain claimed by another tenant as CONFLICT, not a 500', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      ...DOMAIN_ROW,
      micrositeId: 'other-site',
      organizationId: OTHER_ORG_ID,
      status: 'active',
    });

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(provider.add).not.toHaveBeenCalled();
  });

  it('turns a lost unique-violation race into CONFLICT, not INTERNAL_ERROR', async () => {
    db.insertReturning.mockRejectedValue(
      uniqueViolation('microsite_domain_domain_unique')
    );
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        ...DOMAIN_ROW,
        micrositeId: 'other-site',
        organizationId: OTHER_ORG_ID,
      });

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  // ── Idempotency ──────────────────────────────────────────────────
  it('is idempotent: re-adding our own domain returns the same row', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(DOMAIN_ROW);

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.created).toBe(false);
    expect(result.data.id).toBe('dom-1');
    expect(db.insert).not.toHaveBeenCalled();
    // Provisioning re-runs — `provider.add` is idempotent, and a retry after a
    // half-finished first attempt must finish the job.
    expect(provider.add).toHaveBeenCalledTimes(2);
  });

  it('revives a tombstoned row for the SAME tenant', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      ...DOMAIN_ROW,
      status: 'removed',
    });

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(true);
    expect(db.set).toHaveBeenCalledWith({
      status: 'pending_dns',
      errorMessage: null,
    });
  });

  // ── Provider failures ────────────────────────────────────────────
  it('maps a provider CONFLICT onto CONFLICT and records the error on the row', async () => {
    provider.add.mockResolvedValueOnce(
      providerFailure('DOMAIN_CLAIMED', 'already attached elsewhere')
    );

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });

  it('maps an unconfigured provider onto NOT_CONFIGURED, not FORBIDDEN', async () => {
    provider.add.mockResolvedValueOnce(
      providerFailure('NOT_CONFIGURED', 'no token')
    );

    const result = await addMicrositeDomain(db as never, base, deps());
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_CONFIGURED);
  });

  it('does NOT fail the whole add when only the www sibling fails', async () => {
    provider.add
      .mockResolvedValueOnce(
        (await createFakeProvider().add('salon.com')) as never
      )
      .mockResolvedValueOnce(providerFailure('PROVIDER_ERROR') as never);

    const result = await addMicrositeDomain(db as never, base, deps());

    // A site that resolves on the apex but not on www is degraded, not broken.
    expect(result.success).toBe(true);
  });

  it('still succeeds when the registrar lookup fails entirely', async () => {
    resolveNameservers.mockRejectedValue(new Error('ESERVFAIL'));

    const result = await addMicrositeDomain(db as never, base, deps());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instructions.registrar.id).toBe('unknown');
    expect(result.data.instructions.notes.length).toBeGreaterThan(0);
  });
});
