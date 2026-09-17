import { apiClient } from '@borradh-workspace/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listServicesQueryOptions } from './list-services.hook';

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

vi.mock('@borradh-workspace/contracts', () => ({
  listServicesResponseSchema: {},
}));

const get = vi.mocked(apiClient.get);

/** A page of `count` services, named so order is checkable across pages. */
const page = (count: number, total: number, from = 0) => ({
  items: Array.from({ length: count }, (_, i) => ({
    id: `svc_${from + i}`,
    name: `Service ${from + i}`,
  })),
  total,
  limit: count,
  offset: from,
});

/** Run the queryFn the way React Query would. */
const run = async (params?: Parameters<typeof listServicesQueryOptions>[0]) => {
  const { queryFn } = listServicesQueryOptions(params);
  if (typeof queryFn !== 'function') {
    throw new Error('queryFn must be a function');
  }
  return (await queryFn({} as never)) as {
    items: Array<{ id: string }>;
    total: number;
  };
};

/** The `?...` query string of the nth request. */
const urlOf = (call: number) => String(get.mock.calls[call]?.[0] ?? '');

beforeEach(() => vi.clearAllMocks());

describe('listServicesQueryOptions — the catalogue is all of it', () => {
  it('walks every page when no limit is given', async () => {
    // 250 services: the exact shape that made this bug customer-visible.
    get
      .mockResolvedValueOnce(page(100, 250, 0) as never)
      .mockResolvedValueOnce(page(100, 250, 100) as never)
      .mockResolvedValueOnce(page(50, 250, 200) as never);

    const result = await run({ isActive: true });

    expect(get).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(250);
    // Pages are concatenated in order, not interleaved or deduped away.
    expect(result.items[0]?.id).toBe('svc_0');
    expect(result.items[249]?.id).toBe('svc_249');
  });

  it('asks for the maximum page size and advances the offset', async () => {
    get
      .mockResolvedValueOnce(page(100, 150, 0) as never)
      .mockResolvedValueOnce(page(50, 150, 100) as never);

    await run({ isActive: true });

    expect(urlOf(0)).toContain('limit=100');
    expect(urlOf(0)).toContain('offset=0');
    expect(urlOf(1)).toContain('offset=100');
  });

  it('stops after one request when the first page is the whole catalogue', async () => {
    // The common case — 40 services, the org from the bug report. Previously
    // the server default of 10 truncated this to a quarter of the list.
    get.mockResolvedValueOnce(page(40, 40, 0) as never);

    const result = await run({ isActive: true });

    expect(get).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(40);
  });

  it('honours an explicit limit as a single page — no walking', async () => {
    get.mockResolvedValueOnce(page(10, 250, 0) as never);

    const result = await run({ isActive: true, limit: 10 });

    expect(get).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toContain('limit=10');
    expect(result.items).toHaveLength(10);
  });

  it('stops on a short page even if `total` overstates the count', async () => {
    // A wrong `total` must not spin the walk; the short page is the real end.
    get
      .mockResolvedValueOnce(page(100, 9999, 0) as never)
      .mockResolvedValueOnce(page(7, 9999, 100) as never);

    const result = await run({});

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(107);
  });

  it('stops on an empty page rather than looping forever', async () => {
    // A server that keeps reporting a huge total but returns nothing.
    get
      .mockResolvedValueOnce(page(100, 9999, 0) as never)
      .mockResolvedValue(page(0, 9999, 100) as never);

    const result = await run({});

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(100);
  });

  it('caps the walk so a server that never terminates cannot hang the dialog', async () => {
    // Always a full page, always more to come — the pathological case.
    get.mockResolvedValue(page(100, 1_000_000, 0) as never);

    const result = await run({});

    expect(get).toHaveBeenCalledTimes(50); // MAX_PAGES
    expect(result.items).toHaveLength(5000);
  });

  it('keeps the active-only default and passes filters through', async () => {
    get.mockResolvedValueOnce(page(1, 1, 0) as never);

    await run({ category: 'treatment' });

    expect(urlOf(0)).toContain('isActive=true');
    expect(urlOf(0)).toContain('category=treatment');
  });

  it('can be asked for archived services too', async () => {
    get.mockResolvedValueOnce(page(1, 1, 0) as never);

    await run({ isActive: undefined });

    expect(urlOf(0)).not.toContain('isActive');
  });
});
