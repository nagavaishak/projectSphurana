/**
 * A drizzle-shaped mock just rich enough for these services.
 *
 * Test-only. Kept next to the fixtures rather than inlined per file so the
 * chain shapes (`insert().values().returning()`,
 * `update().set().where().returning()`) are defined once — getting one of them
 * subtly wrong is how a test ends up asserting against `undefined`.
 */

import { vi } from 'vitest';

export const createMockDb = () => {
  const insertReturning = vi.fn();
  const updateReturning = vi.fn();

  /** Awaitable AND chainable — `await tx.insert(t).values(v)` is a real path. */
  const valuesResult = () => {
    const thenable = Promise.resolve(undefined) as Promise<unknown> & {
      returning: typeof insertReturning;
    };
    thenable.returning = insertReturning;
    return thenable;
  };

  const values = vi.fn(() => valuesResult());
  const insert = vi.fn(() => ({ values }));

  /** Awaitable AND chainable — a pointer move with no `.returning()` is a real path. */
  const whereResult = () => {
    const thenable = Promise.resolve(undefined) as Promise<unknown> & {
      returning: typeof updateReturning;
    };
    thenable.returning = updateReturning;
    return thenable;
  };

  const where = vi.fn(() => whereResult());
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  const deleteWhere = vi.fn(() => Promise.resolve(undefined));
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

  /** `select().from().where()` — resolves to whatever `selectRows` is set to. */
  const selectRows = vi.fn(async () => [] as unknown[]);
  const selectWhere = vi.fn(() => selectRows());
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const db = {
    query: {
      microsite: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositePage: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeRevision: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeDomain: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    insert,
    values,
    insertReturning,
    update,
    set,
    where,
    updateReturning,
    delete: deleteFrom,
    deleteWhere,
    select,
    selectFrom,
    selectWhere,
    selectRows,
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => await fn(db)
    ),
  };

  return db;
};

export type MockDb = ReturnType<typeof createMockDb>;

/** A postgres unique violation as `isUniqueViolation` recognises it. */
export const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`duplicate key value violates "${constraint}"`), {
    code: '23505',
    constraint_name: constraint,
  });
