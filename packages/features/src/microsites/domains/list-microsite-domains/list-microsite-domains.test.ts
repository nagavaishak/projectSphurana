import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MockDb,
  createMockDb,
} from '../../services/shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
} from '../../services/shared/test-fixtures.test-utils.js';
import { listMicrositeDomains } from './list-microsite-domains.service.js';

let db: MockDb;

const base = { micrositeId: SITE_ID, organizationId: ORG_ID };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'dom-1',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  domain: 'salon.com',
  isPrimary: false,
  status: 'active',
  verification: null,
  ...overrides,
});

describe('listMicrositeDomains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it('returns the site domains and names the active primary', async () => {
    db.query.micrositeDomain.findMany.mockResolvedValue([
      row({ isPrimary: true }),
      row({ id: 'dom-2', domain: 'old.com', status: 'removed' }),
    ]);

    const result = await listMicrositeDomains(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.primaryDomain).toBe('salon.com');
  });

  it('does not treat a non-active primary as the canonical host', async () => {
    db.query.micrositeDomain.findMany.mockResolvedValue([
      row({ isPrimary: true, status: 'error' }),
    ]);

    const result = await listMicrositeDomains(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.primaryDomain).toBeNull();
  });

  it('scopes by org, so a cross-org site id lists nothing', async () => {
    db.query.micrositeDomain.findMany.mockResolvedValue([]);

    const result = await listMicrositeDomains(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items).toEqual([]);
    expect(result.data.primaryDomain).toBeNull();
  });
});
