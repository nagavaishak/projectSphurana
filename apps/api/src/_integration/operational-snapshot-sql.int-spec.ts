import { db } from '@borradh-workspace/database';
/**
 * Syntax guard for `buildOperationalSnapshot`'s five hand-written SQL reads.
 *
 * Why this exists. In June a misplaced cast — `MAX(...)::float FILTER (WHERE
 * ...)` instead of `MAX(...) FILTER (WHERE ...)::float` — made the chat-feed
 * query unparseable: the cast ends the aggregate expression, so Postgres
 * rejects the following FILTER. It ran in production for five days (275
 * events, `assistant.buildOperationalSnapshot.read`) before being fixed in
 * 55db964ab.
 *
 * Nothing caught it because `build-operational-snapshot.test.ts` mocks
 * `db.execute` — the SQL string is asserted about, never sent to a server. A
 * raw-SQL syntax error is invisible to every unit test and to typecheck; only
 * a real Postgres can reject it.
 *
 * So: run the real service against the real test database. The five reads
 * happen unconditionally and before any embedding work, so this exercises
 * every one of them. The assertion is deliberately narrow — it does NOT
 * require overall success (later steps need an embedding provider this suite
 * has no key for), only that the reads themselves parsed and executed.
 */
import { buildOperationalSnapshot } from '@borradh-workspace/features/assistant';
import { seedOrganization } from './harness.js';

/** The failure the read `catch` block returns; see the service impl. */
const READ_FAILURE = 'Failed to read operational data for snapshot';

describe('buildOperationalSnapshot raw SQL', () => {
  it('parses and executes all five feed queries against a real Postgres', async () => {
    const organizationId = await seedOrganization();

    const result = await buildOperationalSnapshot(db, {
      organizationId,
      // Pinned so the query's date params are deterministic.
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    // A syntax error in ANY of the five reads surfaces here.
    if (!result.success) {
      expect(result.error.message).not.toBe(READ_FAILURE);
    }
  });
});
