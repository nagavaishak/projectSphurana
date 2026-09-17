import { sendHtmlEmail } from '@borradh-workspace/email';
import { getRedis } from '@borradh-workspace/redis';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  type DomainMockDb,
  createDomainMockDb,
} from './domain-mock-db.test-utils.js';
import { verifyMicrositeDomain } from './verify-microsite-domain.service.js';

const NOW = new Date('2026-02-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const domainRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'dom-1',
  micrositeId: 'site-1',
  organizationId: 'org-1',
  domain: 'salon.com',
  isPrimary: false,
  status: 'verifying',
  verification: {},
  lastCheckedAt: null,
  errorMessage: null,
  createdAt: new Date(NOW.getTime() - 60_000),
  updatedAt: NOW,
  ...overrides,
});

const provider = (verified: boolean) => ({
  add: vi.fn(),
  remove: vi.fn(),
  verify: vi.fn(async () => ({
    success: true as const,
    data: {
      domain: 'salon.com',
      state: verified ? ('active' as const) : ('verifying' as const),
      records: [],
    },
  })),
});

let db: DomainMockDb;

const redis = () => vi.mocked(getRedis)();

describe('verifyMicrositeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createDomainMockDb();
    db.query.microsite.findFirst.mockResolvedValue({ slug: 'acme' });
    db.query.micrositeDomain.findFirst.mockResolvedValue(domainRow());
    vi.mocked(redis().set).mockResolvedValue('OK');
    vi.mocked(redis().get).mockResolvedValue(null);
    vi.mocked(redis().del).mockResolvedValue(1);
  });

  it('does nothing when another worker holds the lock', async () => {
    vi.mocked(redis().set).mockResolvedValueOnce(null);
    const p = provider(true);

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: p as never, now: NOW }
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('locked');
    expect(p.verify).not.toHaveBeenCalled();
  });

  it('stays pending, and records the check, while DNS has not propagated', async () => {
    const p = provider(false);

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: p as never, now: NOW }
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('pending');
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'verifying', lastCheckedAt: NOW })
    );
  });

  it('activates, makes the domain primary, and enqueues the domain_changed fan-out', async () => {
    db.updateReturnQueue.push([{ id: 'dom-1' }], [{ id: 'dom-1' }]);
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce(domainRow())
      // no existing primary — the site is still on its borradh.io subdomain
      .mockResolvedValueOnce(undefined);
    const enqueue = vi.fn(async () => ({ jobId: 'job-1' }));

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: provider(true) as never, now: NOW, enqueue }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('activated');
    expect(result.data.primaryChangedFrom).toBe('acme.borradh.io');
    expect(result.data.primaryChangedTo).toBe('salon.com');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        previousHost: 'acme.borradh.io',
        newHost: 'salon.com',
      })
    );
  });

  it('busts the host cache for the old and new hosts on activation', async () => {
    db.updateReturnQueue.push([{ id: 'dom-1' }], [{ id: 'dom-1' }]);
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce(domainRow())
      .mockResolvedValueOnce(undefined);

    await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: provider(true) as never, now: NOW, enqueue: vi.fn() }
    );

    const keys = vi.mocked(redis().del).mock.calls.flat();
    expect(keys).toContain('microsite:host:salon.com');
    expect(keys).toContain('microsite:host:acme.borradh.io');
  });

  it('does not fan out twice when two workers activate the same domain', async () => {
    // The conditional activation update returns no row: another worker already
    // moved it out of `verifying`.
    db.updateReturnQueue.push([]);
    const enqueue = vi.fn();

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: provider(true) as never, now: NOW, enqueue }
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('already_active');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('gives up at 7 days into a terminal error with an actionable message, and emails once', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      domainRow({ createdAt: new Date(NOW.getTime() - 7 * DAY) })
    );
    db.updateReturnQueue.push([{ id: 'dom-1' }]);
    db.selectQueue.push([
      { userId: 'u1', name: 'Owner', email: 'owner@salon.com' },
    ]);
    const p = provider(true);

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: p as never, now: NOW }
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('gave_up');
    // The provider is never consulted once the deadline has passed.
    expect(p.verify).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorMessage: expect.stringContaining('7 days'),
      })
    );
    expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendHtmlEmail).mock.calls[0][0].to).toEqual([
      'owner@salon.com',
    ]);
  });

  it('sends only one give-up email when two workers reach the deadline together', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      domainRow({ createdAt: new Date(NOW.getTime() - 8 * DAY) })
    );
    // First run claims the transition; the second finds no row to update.
    db.updateReturnQueue.push([{ id: 'dom-1' }], []);
    db.selectQueue.push([
      { userId: 'u1', name: 'Owner', email: 'owner@salon.com' },
    ]);

    const deps = { provider: provider(true) as never, now: NOW };
    const first = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      deps
    );
    const second = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      deps
    );

    expect(first.success && first.data.outcome).toBe('gave_up');
    expect(second.success && second.data.outcome).toBe('terminal');
    expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-active domain alone', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      domainRow({ status: 'active' })
    );
    const p = provider(true);

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: p as never, now: NOW }
    );

    expect(result.success && result.data.outcome).toBe('terminal');
    expect(p.verify).not.toHaveBeenCalled();
  });

  it('never makes the www half of a pair the primary host', async () => {
    db.updateReturnQueue.push([{ id: 'dom-1' }]);
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce(domainRow({ domain: 'www.salon.com' }))
      .mockResolvedValueOnce(undefined);
    const enqueue = vi.fn();

    const result = await verifyMicrositeDomain(
      db as never,
      { domainId: 'dom-1' },
      { provider: provider(true) as never, now: NOW, enqueue }
    );

    expect(result.success && result.data.outcome).toBe('activated');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
