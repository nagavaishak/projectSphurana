import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock of the database env so we can toggle RLS_ENABLED per test.
// rlsEnabled() reads databaseEnv.RLS_ENABLED at call time, so flipping this
// field between tests is sufficient — no module re-import needed.
const mockEnv = {
  databaseEnv: {
    RLS_ENABLED: false,
    DATABASE_URL: 'postgres://localhost:5432/test',
    NODE_ENV: 'test' as const,
  },
};
vi.mock('@borradh-workspace/env/database', () => mockEnv);

// Fake role pools. Under enforcement the helpers MUST connect via these
// (app_authenticated / app_public / app_system), NOT via any `db` threaded in
// from a controller — otherwise the owner pool would bypass RLS. Hoisted so the
// vi.mock factory below can reference them.
const pools = vi.hoisted(() => {
  const make = () => {
    const queries: unknown[] = [];
    const tx = {
      execute: vi.fn(async (q: unknown) => {
        queries.push(q);
        return [];
      }),
    };
    const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx)
    );
    return { db: { transaction } as never, transaction, tx, queries };
  };
  return { auth: make(), pub: make(), sys: make() };
});
vi.mock('./client.js', () => ({
  dbAuthenticated: pools.auth.db,
  dbPublic: pools.pub.db,
  dbSystem: pools.sys.db,
}));

// Import AFTER the mocks are registered.
const {
  withOrgScope,
  withPublicOrgScope,
  withSystemScope,
  runWithRlsContext,
  getRlsContext,
} = await import('./rls-context.js');

/** Recursively collect every primitive string in an object graph, to find a
 * bound parameter value inside a drizzle SQL object without depending on its
 * internal Param shape. */
function collectStrings(
  value: unknown,
  out: string[] = [],
  seen = new Set()
): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, seen);
    }
  }
  return out;
}

/** A throwaway fake db a caller might thread in via `{ db }` (e.g. the owner
 * pool, or a test mock). Under enforcement the helpers must IGNORE it. */
function makeFakeDb() {
  const tx = { execute: vi.fn(async () => []) };
  const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx)
  );
  const db = { transaction } as never;
  return { db, transaction, tx };
}

function boundValues(queries: unknown[]): string[] {
  return queries.flatMap((q) => collectStrings(q));
}

beforeEach(() => {
  mockEnv.databaseEnv.RLS_ENABLED = false;
  for (const p of [pools.auth, pools.pub, pools.sys]) {
    p.transaction.mockClear();
    p.tx.execute.mockClear();
    p.queries.length = 0;
  }
});

describe('withOrgScope', () => {
  it('passes through with NO transaction when RLS_ENABLED is false', async () => {
    const { db, transaction } = makeFakeDb();
    const result = await withOrgScope(
      async (conn) => {
        expect(conn).toBe(db); // flag off → honor the threaded db
        return 'ok';
      },
      { db }
    );
    expect(result).toBe('ok');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses the app_authenticated pool (ignoring a threaded db) + sets org id when RLS on', async () => {
    mockEnv.databaseEnv.RLS_ENABLED = true;
    const threaded = makeFakeDb(); // owner pool a controller would pass — must be ignored

    const result = await runWithRlsContext(
      { organizationId: 'org_abc', userId: 'user_123' },
      () =>
        withOrgScope(
          async (conn) => {
            expect(conn).toBe(pools.auth.tx); // role pool, NOT the threaded db
            return 'scoped';
          },
          { db: threaded.db }
        )
    );

    expect(result).toBe('scoped');
    expect(pools.auth.transaction).toHaveBeenCalledTimes(1);
    expect(threaded.transaction).not.toHaveBeenCalled(); // threaded db ignored
    expect(boundValues(pools.auth.queries)).toContain('org_abc');
    expect(boundValues(pools.auth.queries)).toContain('user_123');
  });

  it('fails fast when RLS is on but no org context is present', async () => {
    mockEnv.databaseEnv.RLS_ENABLED = true;
    await expect(withOrgScope(async () => 'never')).rejects.toThrow(
      /without an RLS organization context/
    );
    expect(pools.auth.transaction).not.toHaveBeenCalled();
  });

  it('bypasses on the app_system pool when nested inside withSystemScope', async () => {
    // A worker/webhook/cron path (withSystemScope) calling a shared feature
    // service that happens to use withOrgScope must NOT fail-fast — it runs as
    // the BYPASSRLS app_system role (cross-org by design), not app_authenticated.
    mockEnv.databaseEnv.RLS_ENABLED = true;

    const result = await withSystemScope(() =>
      withOrgScope(async (conn) => {
        expect(conn).toBe(pools.sys.db); // app_system pool, not app_authenticated
        return 'system-bypass';
      })
    );

    expect(result).toBe('system-bypass');
    // No org transaction, no SET LOCAL — mirrors withSystemScope.
    expect(pools.auth.transaction).not.toHaveBeenCalled();
    expect(pools.sys.transaction).not.toHaveBeenCalled();
  });
});

describe('withPublicOrgScope', () => {
  it('passes through with no transaction when RLS_ENABLED is false', async () => {
    const { db, transaction } = makeFakeDb();
    const result = await withPublicOrgScope(
      'org_book',
      async () => 'public-ok',
      {
        db,
      }
    );
    expect(result).toBe('public-ok');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses the app_public pool (ignoring a threaded db) + sets explicit org when RLS on', async () => {
    mockEnv.databaseEnv.RLS_ENABLED = true;
    const threaded = makeFakeDb();

    await withPublicOrgScope('org_book', async () => 'public-scoped', {
      db: threaded.db,
    });

    expect(pools.pub.transaction).toHaveBeenCalledTimes(1);
    expect(threaded.transaction).not.toHaveBeenCalled();
    expect(boundValues(pools.pub.queries)).toContain('org_book');
  });
});

describe('withSystemScope', () => {
  it('honors a threaded db when RLS is off (passthrough)', async () => {
    const { db } = makeFakeDb();
    const result = await withSystemScope(
      async (conn) => {
        expect(conn).toBe(db);
        return 'system-off';
      },
      { db }
    );
    expect(result).toBe('system-off');
  });

  it('uses the app_system pool (no txn) and ignores a threaded db when RLS on', async () => {
    mockEnv.databaseEnv.RLS_ENABLED = true;
    const threaded = makeFakeDb();

    const result = await withSystemScope(
      async (conn) => {
        expect(conn).toBe(pools.sys.db); // app_system pool, not the threaded db
        return 'system-ok';
      },
      { db: threaded.db }
    );

    expect(result).toBe('system-ok');
    expect(pools.sys.transaction).not.toHaveBeenCalled(); // BYPASSRLS → no txn
    expect(threaded.transaction).not.toHaveBeenCalled();
  });
});

describe('AsyncLocalStorage carrier', () => {
  it('exposes the bound context via getRlsContext inside the run', () => {
    const seen = runWithRlsContext({ organizationId: 'org_xyz' }, () =>
      getRlsContext()
    );
    expect(seen).toEqual({ organizationId: 'org_xyz' });
    // …and is cleared outside the run.
    expect(getRlsContext()).toBeUndefined();
  });
});
