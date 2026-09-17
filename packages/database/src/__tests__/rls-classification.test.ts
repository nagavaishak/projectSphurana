/**
 * Total RLS classification — every table is accounted for, or the build fails.
 *
 * The old coverage gate (`scripts/rls/check-rls-coverage.mjs`) only iterated
 * Bucket A (tables WITH `organization_id`) and reported green. It therefore said
 * nothing at all about the 48 Bucket B tables — twelve of which have no policy,
 * with nothing anywhere recording whether that is intentional.
 *
 * This test (and the script, which shares the same derivation) requires that
 * EVERY table in the latest drizzle snapshot resolves to exactly one of:
 *
 *   - an isolating policy: org / child_org / join_org / org_self / user
 *   - an explicit `RLS_GLOBAL_EXEMPT` entry WITH a written reason
 *
 * Both inputs are derived from the artifacts themselves — the schema module and
 * the snapshot. Neither is a hand-typed list of tables. A new table shipped with
 * neither a policy nor a reason fails here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RLS_GLOBAL_EXEMPT,
  RLS_POLICY_KINDS,
  classifyRlsTables,
} from '../rls-policy.js';
import * as schema from '../schema/index.js';

const META_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../drizzle/meta'
);

/** The tables that actually exist in the database, per the latest snapshot. */
function loadSnapshotTables(): { name: string; columns: string[] }[] {
  const snapshots = readdirSync(META_DIR)
    .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    .sort();
  const latest = snapshots[snapshots.length - 1];
  const snapshot = JSON.parse(readFileSync(join(META_DIR, latest), 'utf8'));

  return Object.entries(snapshot.tables as Record<string, { columns: object }>)
    .map(([key, data]) => ({
      name: key.replace(/^public\./, ''),
      columns: Object.keys(data.columns ?? {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const snapshotTables = loadSnapshotTables();
const classification = classifyRlsTables(
  schema as unknown as Record<string, unknown>
);

describe('RLS classification is total', () => {
  it('found tables to classify', () => {
    expect(snapshotTables.length).toBeGreaterThan(100);
  });

  it.each(snapshotTables)(
    '$name is classified (policy or a written exemption)',
    ({ name }) => {
      const entry = classification.get(name);
      const kinds = entry?.policies ?? [];
      const exempt = entry?.exemptReason;

      const kindList = Object.entries(RLS_POLICY_KINDS)
        .map(([n, why]) => `  - ${n}: ${why}`)
        .join('\n');

      expect(
        kinds.length > 0 || Boolean(exempt),
        `Table "${name}" has NO RLS policy and NO RLS_GLOBAL_EXEMPT entry.
Every table must resolve to one of:
${kindList}
  - RLS_GLOBAL_EXEMPT in packages/database/src/rls-policy.ts, with a reason a human reads in review.`
      ).toBe(true);

      expect(
        kinds.length > 0 && Boolean(exempt),
        `Table "${name}" is BOTH policied (${kinds.join(', ')}) and listed in RLS_GLOBAL_EXEMPT. The classification must be unambiguous — remove one.`
      ).toBe(false);

      expect(
        kinds.length,
        `Table "${name}" carries more than one isolating policy (${kinds.join(', ')}). Permissive policies OR together, so a second one can only widen access.`
      ).toBeLessThanOrEqual(1);
    }
  );

  it('every RLS_GLOBAL_EXEMPT entry names a real table with a real reason', () => {
    const known = new Set(snapshotTables.map((t) => t.name));
    for (const [table, reason] of Object.entries(RLS_GLOBAL_EXEMPT)) {
      expect(
        known.has(table),
        `RLS_GLOBAL_EXEMPT names "${table}", which is not a table in the snapshot — stale entry.`
      ).toBe(true);
      expect(
        reason.trim().length,
        `RLS_GLOBAL_EXEMPT["${table}"] has no meaningful reason.`
      ).toBeGreaterThan(20);
    }
  });

  it('every table with an organization_id column uses org_isolation', () => {
    // The direct column comparison is strictly safer than an EXISTS join, so a
    // Bucket A table must never be classified as a child/join. The one
    // legitimate exception is a table that is USER-scoped despite having an
    // organization_id (onboarding_session), which declares `user_isolation`.
    const offenders = snapshotTables
      .filter((t) => t.columns.includes('organization_id'))
      // A table may carry an organization_id that is NOT a tenant-isolation key
      // — e.g. patient_session's org PIN (which clinic the BA session was minted
      // for). Those are RLS_GLOBAL_EXEMPT with a written reason and validated by
      // the system-scoped BA services, so they're outside this rule.
      .filter((t) => !(t.name in RLS_GLOBAL_EXEMPT))
      .filter((t) => {
        const kinds = classification.get(t.name)?.policies ?? [];
        return !(
          kinds.includes('org_isolation') || kinds.includes('user_isolation')
        );
      })
      .map((t) => t.name);

    expect(
      offenders,
      'tables with organization_id that do not use orgRlsPolicy'
    ).toEqual([]);
  });
});
