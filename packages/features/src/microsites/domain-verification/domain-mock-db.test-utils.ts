/**
 * A drizzle-shaped mock for the domain-verification services.
 *
 * Local rather than the microsites services mock because these services use
 * two chains that one does not: `select().from().innerJoin().where()` (the
 * admin recipients) and a `.returning()` on the conditional updates whose
 * result has to differ BETWEEN CALLS — that difference is how the idempotency
 * tests express "another worker got there first".
 */

import { vi } from 'vitest';

export const createDomainMockDb = () => {
  /** Queue: one entry per conditional update, in call order. */
  const updateReturnQueue: unknown[][] = [];
  const updateReturning = vi.fn(async () => updateReturnQueue.shift() ?? []);

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

  /** Queue: one entry per `select()`, in call order. */
  const selectQueue: unknown[][] = [];
  const selectWhere = vi.fn(async () => selectQueue.shift() ?? []);
  const selectChain: { where: typeof selectWhere; innerJoin: () => unknown } = {
    where: selectWhere,
    innerJoin: vi.fn(() => selectChain),
  };
  const from = vi.fn(() => selectChain);
  const select = vi.fn(() => ({ from }));

  return {
    query: {
      microsite: { findFirst: vi.fn(), findMany: vi.fn() },
      micrositeDomain: { findFirst: vi.fn(), findMany: vi.fn() },
      organization: { findFirst: vi.fn() },
      // Domain activation now also runs Meta domain verification, which
      // resolves credentials through this table. Unset => no integration =>
      // the verification step no-ops, which is what these tests want.
      metaAdsIntegration: { findFirst: vi.fn() },
    },
    update,
    set,
    where,
    updateReturning,
    updateReturnQueue,
    select,
    from,
    selectWhere,
    selectQueue,
  };
};

export type DomainMockDb = ReturnType<typeof createDomainMockDb>;
