import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { changePrimaryDomain } from './change-primary-domain.service.js';
import {
  type DomainMockDb,
  createDomainMockDb,
} from './domain-mock-db.test-utils.js';

let db: DomainMockDb & { transaction: ReturnType<typeof vi.fn> };

const input = {
  domainId: 'dom-2',
  micrositeId: 'site-1',
  organizationId: 'org-1',
};

describe('changePrimaryDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const base = createDomainMockDb();
    db = Object.assign(base, {
      transaction: vi.fn(
        async (fn: (tx: unknown) => Promise<unknown>) => await fn(db)
      ),
    });
    db.query.microsite.findFirst.mockResolvedValue({ slug: 'acme' });
  });

  it('enqueues the §4 fan-out when an owner switches the canonical host', async () => {
    db.query.micrositeDomain.findFirst
      // the target
      .mockResolvedValueOnce({
        id: 'dom-2',
        domain: 'new.com',
        status: 'active',
        isPrimary: false,
      })
      // the current primary
      .mockResolvedValueOnce({ id: 'dom-1', domain: 'old.com' });
    const enqueue = vi.fn(async () => ({ jobId: 'job-1' }));

    const result = await changePrimaryDomain(db as never, input, { enqueue });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.domainChangedEnqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ previousHost: 'old.com', newHost: 'new.com' })
    );
  });

  it('treats the first promotion as a change from the borradh.io subdomain', async () => {
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce({
        id: 'dom-2',
        domain: 'new.com',
        status: 'active',
        isPrimary: false,
      })
      .mockResolvedValueOnce(undefined);
    const enqueue = vi.fn(async () => ({ jobId: 'job-1' }));

    await changePrimaryDomain(db as never, input, { enqueue });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ previousHost: 'acme.borradh.io' })
    );
  });

  it('does not fan out when the promotion failed', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValueOnce(undefined);
    const enqueue = vi.fn();

    const result = await changePrimaryDomain(db as never, input, { enqueue });

    expect(result.success).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
