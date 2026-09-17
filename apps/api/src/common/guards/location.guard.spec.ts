// The location header is the ONE piece of tenant scoping that arrives from the
// client rather than from the session, so this guard is a tenant boundary, not
// a convenience. Each case below is one way that boundary can be lost:
//
//   - another org's location id being accepted (the cross-tenant read)
//   - a valid id not reaching the handler (silent org-wide fallback, which
//     looks like "the filter doesn't work" rather than like a bug)
//   - an ABSENT header being treated as an error, which would 4xx every client
//     that has not adopted the header yet — i.e. all of them, today
//
// The resolver is mocked because what is under test is the guard's decision,
// not the query; `resolve-active-location.service.ts` owns the query.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
  withSystemScope: (fn: (conn: unknown) => unknown) => fn({}),
}));

const resolveActiveLocation = jest.fn();
jest.mock('@borradh-workspace/features/organization-locations', () => ({
  resolveActiveLocation: (...args: unknown[]) => resolveActiveLocation(...args),
}));

import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { LocationGuard } from './location.guard.js';

interface Req {
  headers: Record<string, string | undefined>;
  activeOrganizationId?: string;
  activeLocationId?: string;
}

function ctx(request: Req): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const ok = (id: string, organizationId: string) => ({
  success: true as const,
  data: { id, organizationId, name: 'Branch', isPrimary: false },
});
const notFound = {
  success: false as const,
  error: { code: 'NOT_FOUND', message: 'Location not found' },
};

describe('LocationGuard', () => {
  let guard: LocationGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    // A fresh guard is not enough — the validated-pair cache is module-level,
    // so every case uses distinct ids rather than relying on isolation.
    guard = new LocationGuard();
  });

  it('publishes a location that belongs to the active org', async () => {
    resolveActiveLocation.mockResolvedValue(ok('loc_own', 'org_a'));
    const request: Req = {
      headers: { 'x-location-id': 'loc_own' },
      activeOrganizationId: 'org_a',
    };

    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.activeLocationId).toBe('loc_own');
  });

  it('rejects a location belonging to ANOTHER org — the cross-tenant read', async () => {
    resolveActiveLocation.mockResolvedValue(notFound);
    const request: Req = {
      headers: { 'x-location-id': 'loc_theirs' },
      activeOrganizationId: 'org_a',
    };

    await expect(guard.canActivate(ctx(request))).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(request.activeLocationId).toBeUndefined();
  });

  it('passes through with no header, leaving the request org-wide', async () => {
    const request: Req = { headers: {}, activeOrganizationId: 'org_a' };

    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.activeLocationId).toBeUndefined();
    expect(resolveActiveLocation).not.toHaveBeenCalled();
  });

  it('treats a blank / whitespace header as absent, not as an id', async () => {
    const request: Req = {
      headers: { 'x-location-id': '   ' },
      activeOrganizationId: 'org_a',
    };

    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.activeLocationId).toBeUndefined();
    expect(resolveActiveLocation).not.toHaveBeenCalled();
  });

  it('ignores the header when there is no active org to validate against', async () => {
    const request: Req = { headers: { 'x-location-id': 'loc_x' } };

    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.activeLocationId).toBeUndefined();
    expect(resolveActiveLocation).not.toHaveBeenCalled();
  });

  it('caches a validated pair rather than re-querying per request', async () => {
    resolveActiveLocation.mockResolvedValue(ok('loc_cached', 'org_c'));
    const make = (): Req => ({
      headers: { 'x-location-id': 'loc_cached' },
      activeOrganizationId: 'org_c',
    });

    const first = make();
    const second = make();
    await guard.canActivate(ctx(first));
    await guard.canActivate(ctx(second));

    expect(resolveActiveLocation).toHaveBeenCalledTimes(1);
    expect(second.activeLocationId).toBe('loc_cached');
  });

  it('caches per (org, location), so the same id under another org re-validates', async () => {
    resolveActiveLocation.mockResolvedValueOnce(ok('loc_shared', 'org_d'));
    await guard.canActivate(
      ctx({
        headers: { 'x-location-id': 'loc_shared' },
        activeOrganizationId: 'org_d',
      })
    );

    // Same location id, different org. If the cache key were the id alone,
    // this would be accepted without a check — the exact cross-tenant hole.
    resolveActiveLocation.mockResolvedValueOnce(notFound);
    await expect(
      guard.canActivate(
        ctx({
          headers: { 'x-location-id': 'loc_shared' },
          activeOrganizationId: 'org_e',
        })
      )
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resolveActiveLocation).toHaveBeenCalledTimes(2);
  });
});
