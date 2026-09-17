/**
 * Validate the drizzle migration folder before running `migrate`.
 *
 * Catches the exact class of failure that bit us on staging: a phantom
 * journal entry referencing a SQL file that was never committed, which
 * causes drizzle's migrator to crash mid-deploy with
 *   "No file <tag>.sql found in <folder>"
 *
 * Checks are split into two buckets:
 *
 * Fatal (exit non-zero, blocks CI and migrate):
 *   - Every journal entry has a matching `{tag}.sql` file.
 *   - No orphan `.sql` files in `drizzle/` without a journal entry
 *     (catches "drizzle-kit generate ran but the journal update was
 *     never committed").
 *   - Journal `when` timestamps are strictly monotonically increasing.
 *     Drizzle's migrator only runs migrations where `when >
 *     latest_applied.when`, so a non-monotonic timestamp will be
 *     silently skipped in prod if a later migration was already
 *     applied via a different branch.
 *
 * Fatal (additional, post-baseline-squash):
 *   - Missing snapshot files referenced by journal entries.
 *   - Broken snapshot `prevId` chain (forked or skipping ancestors).
 *
 * Drizzle's runtime migrator doesn't read these — it only uses the
 * journal `tag` and matching SQL file. But drizzle-kit's `generate`
 * command DOES walk the snapshot chain to compute diffs against the
 * current schema. A broken chain produces forked or duplicate
 * migrations on the next PR, the rot we lived through pre-squash. We
 * catch those at PR review time now instead of letting them
 * accumulate.
 *
 * Warnings (printed, do not block):
 *   - Orphan snapshot files not referenced by the journal. These are
 *     inert (drizzle ignores them) and easy to clean up later, so we
 *     don't block on them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface Snapshot {
  id: string;
  prevId: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateMigrations(migrationsFolder: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const journalPath = path.join(migrationsFolder, 'meta/_journal.json');

  if (!fs.existsSync(journalPath)) {
    return { errors: [`Missing journal file: ${journalPath}`], warnings };
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
  const entries = journal.entries ?? [];

  const expectedSqlFiles = new Set<string>();
  const expectedSnapshotFiles = new Set<string>();

  let prevWhen = -1;
  let prevSnapshotId: string | null = null;

  for (const entry of entries) {
    const sqlFile = `${entry.tag}.sql`;
    const sqlPath = path.join(migrationsFolder, sqlFile);
    expectedSqlFiles.add(sqlFile);

    if (!fs.existsSync(sqlPath)) {
      // FATAL — this is the exact failure mode that crashes drizzle mid-migrate.
      errors.push(
        `[journal idx ${entry.idx}] Missing SQL file: ${sqlFile} (referenced by tag "${entry.tag}")`
      );
    }

    const prefix = entry.tag.slice(0, 4);
    const snapshotFile = `${prefix}_snapshot.json`;
    const snapshotPath = path.join(migrationsFolder, 'meta', snapshotFile);
    expectedSnapshotFiles.add(snapshotFile);

    if (!fs.existsSync(snapshotPath)) {
      // FATAL post-squash — drizzle-kit needs the snapshot chain intact
      // to compute the next migration's diff. A missing snapshot makes
      // the next `db:generate` produce a malformed migration (the same
      // class of rot the squash cleaned up).
      errors.push(
        `[journal idx ${entry.idx}] Missing snapshot: meta/${snapshotFile}. drizzle-kit needs this to compute the next migration's diff.`
      );
      prevSnapshotId = null;
    } else {
      const snapshot = JSON.parse(
        fs.readFileSync(snapshotPath, 'utf8')
      ) as Snapshot;

      if (prevSnapshotId && snapshot.prevId !== prevSnapshotId) {
        // FATAL post-squash — a broken `prevId` chain means two PRs
        // forked from the same base both regenerated against the same
        // ancestor. drizzle-kit will produce conflicting migrations on
        // the next PR. Resolve by rebasing on staging and re-running
        // `pnpm db:generate`.
        errors.push(
          `[journal idx ${entry.idx}] Broken snapshot chain: ${snapshotFile}.prevId = "${snapshot.prevId}", expected "${prevSnapshotId}". Rebase on staging and re-run \`pnpm db:generate\`.`
        );
      }
      prevSnapshotId = snapshot.id;
    }

    if (entry.when <= prevWhen) {
      // FATAL — drizzle-orm's migrator uses `when` to decide which
      // migrations are pending, only running those where `when >
      // latest_applied.when`. A non-monotonic timestamp will be
      // silently skipped in prod if a later migration was applied
      // first (e.g. via a different branch). Bump the `when` to be
      // greater than the preceding entry.
      errors.push(
        `[journal idx ${entry.idx}] Out-of-order timestamp: "${entry.tag}" when=${entry.when} is not greater than previous when=${prevWhen}. This will be silently skipped by drizzle in prod.`
      );
    }
    prevWhen = entry.when;
  }

  // Orphan SQL files are FATAL — most common cause is "ran db:generate, forgot
  // to commit the journal, and now the new migration won't run anywhere".
  const allSqlFiles = fs
    .readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'));
  for (const file of allSqlFiles) {
    if (!expectedSqlFiles.has(file)) {
      errors.push(`Orphan SQL file not referenced by journal: ${file}`);
    }
  }

  // Orphan snapshots are warnings (drizzle runtime ignores them).
  const metaFolder = path.join(migrationsFolder, 'meta');
  if (fs.existsSync(metaFolder)) {
    const allSnapshotFiles = fs
      .readdirSync(metaFolder)
      .filter((f) => f.endsWith('_snapshot.json'));
    for (const file of allSnapshotFiles) {
      if (!expectedSnapshotFiles.has(file)) {
        warnings.push(
          `Orphan snapshot not referenced by journal: meta/${file}`
        );
      }
    }
  }

  checkUnguardedNotNullAdds(migrationsFolder, entries, errors);

  return { errors, warnings };
}

/**
 * `ALTER TABLE x ADD COLUMN y ... NOT NULL` with NO DEFAULT succeeds on an
 * EMPTY table and aborts on a populated one with "column contains null
 * values".
 *
 * That asymmetry is why it slips through. `migration-smoke` applies to a fresh
 * postgres, where every table is empty. `migration-prod-copy-smoke` applies to
 * a copy of prod — also empty for any table prod has not started using yet.
 * The environments that actually break are the ones in between: preview and
 * staging, where an earlier migration in the SAME pull request created the
 * table and someone then used the feature. Neither smoke job models that, and
 * the failure lands as a dead deploy.
 *
 * 0133 shipped exactly this on `patient_session.token` / `.user_id`, two
 * migrations after 0131 had already hand-written the same preamble.
 *
 * Accepted when the column carries a DEFAULT, or when the table is backfilled
 * or cleared first — `DELETE FROM "x"` or `UPDATE "x" SET` above the statement.
 */
function checkUnguardedNotNullAdds(
  migrationsFolder: string,
  entries: JournalEntry[],
  errors: string[]
): void {
  // Pre-dates this check and is long applied everywhere, so re-running it is
  // not a risk we can still avoid. Listed explicitly rather than skipped
  // silently: the set cannot grow without a reviewer seeing it in the diff.
  const GRANDFATHERED = new Set(['0036_mature_magus']);

  const addNotNull =
    /ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"\s+([^;]*?)NOT NULL\s*;/gi;

  for (const entry of entries) {
    if (GRANDFATHERED.has(entry.tag)) continue;

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');

    addNotNull.lastIndex = 0;
    let match: RegExpExecArray | null = addNotNull.exec(sql);
    while (match !== null) {
      const [statement, table, column, modifiers] = match;

      if (!/\bDEFAULT\b/i.test(modifiers)) {
        const before = sql.slice(0, match.index);
        const guarded =
          new RegExp(`DELETE\\s+FROM\\s+"${table}"`, 'i').test(before) ||
          new RegExp(`UPDATE\\s+"${table}"\\s+SET`, 'i').test(before);

        if (!guarded) {
          errors.push(
            `${entry.tag}.sql adds NOT NULL column "${table}"."${column}" with no DEFAULT and no preceding backfill. That applies cleanly to an empty table and ABORTS on a populated one, so it passes both smoke jobs and fails the real deploy. Add a DEFAULT, or backfill/clear "${table}" first (see 0131 and 0133). Statement: ${statement.trim()}`
          );
        }
      }

      match = addNotNull.exec(sql);
    }
  }
}

// CLI entry point.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('validate-migrations.js') ||
  process.argv[1]?.endsWith('validate-migrations.ts');

if (isDirectRun) {
  const folderArg = process.argv[2];
  const migrationsFolder = folderArg
    ? path.resolve(folderArg)
    : path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../drizzle'
      );

  console.log(`Validating migrations in: ${migrationsFolder}`);
  const { errors, warnings } = validateMigrations(migrationsFolder);

  if (warnings.length > 0) {
    console.warn(
      `\n⚠️  ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (non-blocking):\n`
    );
    for (const w of warnings) console.warn(`  • ${w}`);
    console.warn('');
  }

  if (errors.length > 0) {
    console.error(
      `\n❌ Migration validation failed (${errors.length} fatal error${errors.length === 1 ? '' : 's'}):\n`
    );
    for (const e of errors) console.error(`  • ${e}`);
    console.error('');
    process.exit(1);
  }

  console.log('✓ Migration folder is valid');
  process.exit(0);
}
