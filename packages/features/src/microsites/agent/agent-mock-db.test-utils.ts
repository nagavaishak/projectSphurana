/**
 * A drizzle-shaped mock for the agent tools.
 *
 * Its own file rather than the services' `mock-db.test-utils.ts`: the tools use
 * chains that one does not (`delete().where().returning()`, the conversation
 * and message query namespaces), and a shared mock that grows a method per
 * consumer is how a chain ends up subtly wrong and a test asserts against
 * `undefined`.
 */

import { vi } from 'vitest';

export const createAgentMockDb = () => {
  const insertReturning = vi.fn(async () => [{ id: 'row-1' }]);
  const updateReturning = vi.fn(async () => [{ id: 'row-1' }]);
  const deleteReturning = vi.fn(async () => [{ id: 'row-1' }]);

  /** Awaitable AND chainable — both `await insert().values(v)` and `.returning()`. */
  const thenableWith = <T>(returning: T) => {
    const thenable = Promise.resolve(undefined) as Promise<unknown> & {
      returning: T;
    };
    thenable.returning = returning;
    return thenable;
  };

  const values = vi.fn(() => thenableWith(insertReturning));
  const insert = vi.fn(() => ({ values }));

  const where = vi.fn(() => thenableWith(updateReturning));
  const set = vi.fn(() => ({ set }));
  const updateSet = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn(() => thenableWith(deleteReturning));
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));

  const db = {
    query: {
      microsite: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositePage: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeRevision: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeConversation: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeMessage: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    },
    insert,
    values,
    insertReturning,
    update,
    updateSet,
    where,
    updateReturning,
    delete: deleteFrom,
    deleteWhere,
    deleteReturning,
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => await fn(db)
    ),
  };

  // Unused alias kept off the object on purpose — `set` above would shadow the
  // update chain's own `set` and hide a wiring mistake.
  void set;

  return db;
};

export type AgentMockDb = ReturnType<typeof createAgentMockDb>;
