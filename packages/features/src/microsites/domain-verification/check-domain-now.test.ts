import { getRedis } from '@borradh-workspace/redis';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { checkDomainNow } from './check-domain-now.service.js';
import {
  type DomainMockDb,
  createDomainMockDb,
} from './domain-mock-db.test-utils.js';

let db: DomainMockDb;

const provider = {
  add: vi.fn(),
  remove: vi.fn(),
  verify: vi.fn(async () => ({
    success: true as const,
    data: { domain: 'salon.com', state: 'verifying' as const, records: [] },
  })),
};

const input = {
  domainId: 'dom-1',
  micrositeId: 'site-1',
  organizationId: 'org-1',
};

describe('checkDomainNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createDomainMockDb();
    vi.mocked(vi.mocked(getRedis)().set).mockResolvedValue('OK');
  });

  it('is NOT_FOUND for a domain owned by another organization', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);

    const result = await checkDomainNow(db as never, input, {
      provider: provider as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it('polls the provider once and returns the refreshed row', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      id: 'dom-1',
      micrositeId: 'site-1',
      organizationId: 'org-1',
      domain: 'salon.com',
      status: 'pending_dns',
      verification: {},
      createdAt: new Date(),
    });

    const result = await checkDomainNow(db as never, input, {
      provider: provider as never,
    });

    expect(result.success).toBe(true);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
});
