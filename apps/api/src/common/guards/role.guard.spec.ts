// Mock the database module before importing the guard. The guard pulls
// `{ and, db, eq, member }` from the database barrel; we only need a
// controllable `db.query.member.findFirst`. The mock fn is created inside the
// factory (not captured from an outer const) to avoid the TDZ that SWC's
// import/jest.mock hoisting otherwise triggers.
jest.mock(
  '@borradh-workspace/database',
  () => ({
    and: (...args: unknown[]) => args,
    eq: (...args: unknown[]) => args,
    member: {},
    db: { query: { member: { findFirst: jest.fn() } } },
  }),
  { virtual: true }
);

import { db } from '@borradh-workspace/database';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator.js';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator.js';
import { RoleGuard } from './role.guard.js';

const mockFindFirst = db.query.member.findFirst as unknown as jest.Mock;

type Meta = { role?: string; permission?: string };

/** Build a guard whose Reflector returns the given route metadata. */
function makeGuard(meta: Meta): RoleGuard {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === REQUIRE_ROLE_KEY
        ? meta.role
        : key === REQUIRE_PERMISSION_KEY
          ? meta.permission
          : undefined,
  };
  return new RoleGuard(reflector as never);
}

function ctx(
  user: { id?: string } | undefined,
  activeOrganizationId: string | undefined
): ExecutionContext {
  const request = { user, activeOrganizationId };
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const authed = ctx({ id: 'user-1' }, 'org-1');

beforeEach(() => {
  mockFindFirst.mockReset();
});

describe('RoleGuard — passthrough', () => {
  it('allows routes with no role/permission metadata without a DB lookup', async () => {
    const guard = makeGuard({});
    await expect(guard.canActivate(authed)).resolves.toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe('RoleGuard — admin-gated routes (ads / posts / offers)', () => {
  const adminGate = () => makeGuard({ role: 'admin' });

  it('blocks a member with 403', async () => {
    mockFindFirst.mockResolvedValue({ role: 'member' });
    await expect(adminGate().canActivate(authed)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('allows an admin', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' });
    await expect(adminGate().canActivate(authed)).resolves.toBe(true);
  });

  it('allows an owner (inherits via hierarchy)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'owner' });
    await expect(adminGate().canActivate(authed)).resolves.toBe(true);
  });

  it('treats a member with a null role as the base tier (403)', async () => {
    mockFindFirst.mockResolvedValue({ role: null });
    await expect(adminGate().canActivate(authed)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});

describe('RoleGuard — owner-only routes (practitioner CRUD / billing)', () => {
  const ownerGate = () => makeGuard({ role: 'owner' });

  it('blocks a member', async () => {
    mockFindFirst.mockResolvedValue({ role: 'member' });
    await expect(ownerGate().canActivate(authed)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('blocks an admin (the demotion regression guard)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' });
    await expect(ownerGate().canActivate(authed)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('allows an owner', async () => {
    mockFindFirst.mockResolvedValue({ role: 'owner' });
    await expect(ownerGate().canActivate(authed)).resolves.toBe(true);
  });
});

describe('RoleGuard — context requirements', () => {
  it('rejects when there is no authenticated user', async () => {
    const guard = makeGuard({ role: 'admin' });
    await expect(
      guard.canActivate(ctx(undefined, 'org-1'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when there is no active organization', async () => {
    const guard = makeGuard({ role: 'admin' });
    await expect(
      guard.canActivate(ctx({ id: 'user-1' }, undefined))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a user who is not a member of the org', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const guard = makeGuard({ role: 'admin' });
    await expect(guard.canActivate(authed)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
