import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type MockDb,
  createMockDb,
} from '../../services/shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
} from '../../services/shared/test-fixtures.test-utils.js';
import {
  type FakeProvider,
  createFakeProvider,
  okRemove,
  providerFailure,
} from '../fake-provider.test-utils.js';
import { removeMicrositeDomain } from './remove-microsite-domain.service.js';

let db: MockDb;
let provider: FakeProvider;

const base = {
  domainId: 'dom-1',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
};

const activeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'dom-1',
  domain: 'salon.com',
  status: 'active',
  ...overrides,
});

describe('removeMicrositeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.micrositeDomain.findFirst.mockResolvedValue(activeRow());
    provider = createFakeProvider();
  });

  it('detaches the pair and tombstones the row rather than deleting it', async () => {
    const result = await removeMicrositeDomain(db as never, base, {
      provider,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe('removed');
    expect(result.data.detachedAtProvider).toBe(true);

    expect(provider.remove).toHaveBeenNthCalledWith(1, 'salon.com');
    expect(provider.remove).toHaveBeenNthCalledWith(2, 'www.salon.com');

    // Tombstone, never DELETE — the global unique on `domain` must not be
    // freed for another tenant to claim.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({
      status: 'removed',
      isPrimary: false,
      errorMessage: null,
    });
  });

  it('returns NOT_FOUND for a cross-org domain id', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);

    const result = await removeMicrositeDomain(
      db as never,
      { ...base, organizationId: OTHER_ORG_ID },
      { provider }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(provider.remove).not.toHaveBeenCalled();
  });

  // ── Idempotency ──────────────────────────────────────────────────
  it('is idempotent: an already-tombstoned row succeeds without a provider call', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      activeRow({ status: 'removed' })
    );

    const result = await removeMicrositeDomain(db as never, base, { provider });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alreadyRemoved).toBe(true);
    expect(provider.remove).not.toHaveBeenCalled();
  });

  it('is idempotent: "already gone at the provider" is still a success', async () => {
    provider.remove.mockImplementation(async (domain: string) =>
      okRemove(domain, true)
    );

    const result = await removeMicrositeDomain(db as never, base, { provider });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.detachedAtProvider).toBe(false);
    expect(result.data.status).toBe('removed');
  });

  it('still disconnects when the provider errors — our row is what serves traffic', async () => {
    provider.remove.mockResolvedValue(
      providerFailure('PROVIDER_ERROR') as never
    );

    const result = await removeMicrositeDomain(db as never, base, { provider });

    expect(result.success).toBe(true);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'removed' })
    );
  });
});
