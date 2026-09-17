import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — services must not pattern-match `error.message` for a
 * Postgres constraint violation (ENG-844).
 *
 * drizzle 0.45.2 re-throws every failed query as a `DrizzleQueryError` whose
 * `.message` is `"Failed query: <sql>\nparams: …"` — it NEVER contains the
 * constraint name or the words "duplicate"/"unique". The real postgres.js
 * error (with `.code`, `.constraint_name`) sits on `.cause`. A service that
 * writes `error.message.includes('duplicate')` (or similar) is checking a
 * string that can never contain what it's looking for: the branch is dead,
 * and the violation silently falls through to INTERNAL_ERROR → HTTP 500
 * instead of the intended 409 ALREADY_EXISTS.
 *
 * The fix is always one of the cause-chain-walking helpers in
 * `packages/database/src/constraints.ts` — `isUniqueViolation`,
 * `isForeignKeyViolation`, `isExclusionViolation`, `pgViolation`, or
 * `mapDbError` — never a message match.
 *
 * This test statically scans every `*.service.ts` under `packages/features/src`
 * for the banned patterns and fails on any match, pointing at the file.
 */

const FEATURES_SRC = path.resolve(__dirname, '..');

/**
 * Banned patterns on `error.message` / a message-shaped string:
 *   - `.includes('duplicate' | 'unique' | 'constraint' | '_unique' | 'uq_')`
 *   - a regex literal testing for the same, e.g. `/duplicate|unique/i.test(...)`
 *
 * These are heuristics for "matching driver-error text by hand" rather than a
 * syntactic parse, which is deliberate: the whole point is that this text
 * NEVER reliably contains the constraint name once drizzle wraps it, so any
 * attempt to hand-match it is the bug, regardless of exact spelling.
 */
const BANNED_INCLUDES_RE =
  /\.includes\(\s*['"`](?:duplicate|unique|constraint|_unique|uq_)/i;
const BANNED_REGEX_TEST_RE =
  /\/(?:[^/\n]*\b(?:duplicate|unique)\b[^/\n]*)\/[a-z]*\.test\(/i;

function collectServiceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectServiceFiles(full, acc);
    } else if (entry.endsWith('.service.ts')) {
      acc.push(full);
    }
  }
}

describe('architecture: services must use the cause-chain constraint helpers, never a message match', () => {
  const files: string[] = [];
  collectServiceFiles(FEATURES_SRC, files);

  it('scans at least the known service modules', () => {
    // Guard against the glob silently matching nothing (which would make the
    // ban assertion vacuously pass).
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no *.service.ts matching error.message for a constraint violation', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const relFile = path
        .relative(path.resolve(FEATURES_SRC, '..'), file)
        .replaceAll(path.sep, '/');

      content.split('\n').forEach((line, idx) => {
        if (BANNED_INCLUDES_RE.test(line) || BANNED_REGEX_TEST_RE.test(line)) {
          violations.push(`${relFile}:${idx + 1} — ${line.trim()}`);
        }
      });
    }

    expect(
      violations.sort(),
      `A *.service.ts file is pattern-matching error.message for a Postgres\nconstraint violation. drizzle wraps every failed query so the constraint\nname/SQLSTATE lives on error.cause, never in error.message — this match can\nnever fire and the violation silently becomes a 500. Use\nisUniqueViolation/isForeignKeyViolation/isExclusionViolation/mapDbError from\n@borradh-workspace/database instead. Offenders:\n  ${violations.sort().join('\n  ')}`
    ).toEqual([]);
  });
});
