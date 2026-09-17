import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "never `vi.mock` a canonically-aliased module".
 *
 * This suite runs with `pool: 'threads'` + `isolate: false` (see
 * `packages/features/vite.config.ts`), so every test file in a worker SHARES one
 * module graph. A file-local `vi.mock('X')` therefore does NOT stay local: the
 * factory persists on the shared graph and every LATER file that imports `X`
 * gets the mock instead of the real module. When the factory is "bare" (returns
 * only the handful of exports that one test needs) it effectively DELETES every
 * other export of `X` for the rest of the run.
 *
 * That is what makes the failure so confusing: the file that *reports* the
 * failure is an innocent victim, and WHICH file that is changes run-to-run with
 * worker scheduling. The classic symptom is "a different test fails every time".
 *
 * A real example this test was written to prevent from recurring — one line in
 * `voice-cloning/.../fetch-page-messages.test.ts` accounted for 8 separate
 * failing files:
 *
 *     vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
 *
 * …which strips `and`, `asc`, `desc`, `sql`, `isNull`, `inArray`, … from the
 * shared graph, so any later service calling `and(...)` explodes on `undefined`.
 *
 * THE RULE
 * --------
 * If a module is canonically aliased in `vite.config.ts`, it already has a
 * shared `src/__mocks__/*.ts` with stable `vi.fn()`s. Do NOT `vi.mock` it.
 * Import the symbol and drive it per-test instead:
 *
 *     import { logError } from '@borradh-workspace/observability';
 *     vi.mocked(logError).mockReturnValue(undefined);   // in beforeEach
 *
 * To control an INTERNAL module, use a RESTORED `vi.spyOn` (keep the handle and
 * call `.mockRestore()` in `afterEach`) so it cannot outlive your file.
 *
 * If you need an export the canonical mock lacks, ADD IT TO THE CANONICAL MOCK.
 * Never re-introduce a file-local `vi.mock` of an aliased module.
 *
 * THE RATCHET
 * -----------
 * `KNOWN_VIOLATIONS` is the burn-down list. It may only ever SHRINK:
 *   - A NEW `vi.mock` of an aliased module → test FAILS (fix the test instead
 *     of baselining it).
 *   - A baselined mock that has been removed but not deleted from the list →
 *     test FAILS (stale baseline), so the list can only go down.
 *
 * DO NOT add entries to `KNOWN_VIOLATIONS` to make a new violation pass.
 *
 * NOTE: the alias list is PARSED OUT OF `vite.config.ts` rather than duplicated
 * here, so adding an alias automatically extends this rule and the two can never
 * drift apart.
 *
 * INTERNAL modules leak the same way, and are policed by the SECOND rule in
 * this file (see HIGH_FANIN_THRESHOLD below) rather than by an alias list.
 *
 * NOT covered by either rule (1) — the REVERSE direction: a hoisted `vi.mock`
 * of an internal module silently MISSES when some earlier file already imported
 * the REAL module into the shared graph (that module's own test usually does).
 * The mock never takes effect and the test's spy records zero calls. This bit
 * `notify-deposit-paid` vs `send-push-notification` at fan-in 4 — below the
 * threshold below, so static analysis will not catch it. A restored `vi.spyOn`
 * is installed at RUN time and works regardless of load order: prefer it for
 * ANY internal module, whatever the fan-in.
 *
 * GOTCHA when migrating to `vi.spyOn` — `mockReset()` means something DIFFERENT
 * on a spy than on a `vi.fn()`. On a `vi.fn()` it drops the implementation,
 * leaving a no-op. On a SPY, vitest 3 restores the ORIGINAL implementation, so
 * calls go THROUGH to the real module — for a queue/DB/API collaborator that
 * means a test can quietly hit real BullMQ, the database, or the Meta API. Two
 * separate migrations hit this. When you convert a `vi.mock` whose `beforeEach`
 * called `mockReset()` (usually there to drain `mock*Once` queues), replace it
 * with an explicit default stub. A fresh spy in `beforeEach` plus
 * `mockRestore()` in `afterEach` already guarantees no queue survives a test,
 * so the reset is redundant as well as dangerous.
 *
 * NOT covered by either rule (2): mock state that leaks BETWEEN TESTS IN ONE FILE.
 * `vi.clearAllMocks()` (and `createMockDatabase()._resetMocks()`) only call
 * `mockClear()`, which keeps persistent implementations AND unconsumed
 * `mock*Once` queues — so a test that queues two `…Once` values but bails after
 * one shifts the NEXT test's queue. Use `mockReset()` (re-installing any
 * defaults it drops) when ordering matters. That class is invisible to static
 * analysis; it shows up as a file that passes alone but fails under shuffle.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const FEATURES_SRC = path.join(REPO_ROOT, 'packages/features/src');
const VITE_CONFIG = path.join(REPO_ROOT, 'packages/features/vite.config.ts');

/**
 * High-fan-in modules that are NOT aliased but must never be file-local mocked
 * either — they are imported by essentially every service, so a bare factory is
 * catastrophic. (`drizzle-orm` is the single worst offender in the package's
 * history; `node:crypto` follows the `node:dns/promises` precedent.)
 */
const EXTRA_FORBIDDEN = ['drizzle-orm', 'node:crypto'];

/** `__mocks__` legitimately defines the canonical mocks; the harness is not product test code. */
const EXCLUDED_PATH_SEGMENTS = ['/__mocks__/', '/_integration/'];

/**
 * Pull every `find:` entry out of the vite alias array. Handles both forms:
 *   { find: '@borradh-workspace/database', ... }   → string PREFIX match
 *   { find: /^@borradh-workspace\/integrations$/ } → exact RegExp match
 *
 * The distinction matters: the `integrations` ROOT is an exact RegExp precisely
 * so that unaliased subpaths (`/shared`, `/loops`, `/notion`) are NOT redirected.
 */
function readAliasedSpecifiers(): { prefixes: string[]; regexes: RegExp[] } {
  const config = readFileSync(VITE_CONFIG, 'utf8');
  const prefixes: string[] = [];
  const regexes: RegExp[] = [];

  const findRe = /find:\s*(?:'([^']+)'|\/((?:[^/\\]|\\.)+)\/)/g;
  let match: RegExpExecArray | null = findRe.exec(config);
  while (match !== null) {
    if (match[1] !== undefined) prefixes.push(match[1]);
    else if (match[2] !== undefined) regexes.push(new RegExp(match[2]));
    match = findRe.exec(config);
  }
  return { prefixes, regexes };
}

const { prefixes: ALIAS_PREFIXES, regexes: ALIAS_REGEXES } =
  readAliasedSpecifiers();

/** Would this import specifier be redirected by an alias (or is it force-banned)? */
function isForbidden(specifier: string): boolean {
  if (ALIAS_REGEXES.some((re) => re.test(specifier))) return true;
  if (
    ALIAS_PREFIXES.some((p) => specifier === p || specifier.startsWith(`${p}/`))
  ) {
    return true;
  }
  return EXTRA_FORBIDDEN.some(
    (m) => specifier === m || specifier.startsWith(`${m}/`)
  );
}

function isExcluded(absPath: string): boolean {
  const normalized = absPath.replaceAll(path.sep, '/');
  return EXCLUDED_PATH_SEGMENTS.some((seg) => normalized.includes(seg));
}

function collectTestFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTestFiles(full, acc);
    } else if (
      (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) &&
      !isExcluded(full)
    ) {
      acc.push(full);
    }
  }
}

/**
 * RATCHET BASELINE — `vi.mock`s of aliased modules that exist TODAY, keyed as
 * `<specifier>::<repo-relative-path>`. This list may only shrink.
 */
const KNOWN_VIOLATIONS: ReadonlySet<string> = new Set([
  // (empty — all aliased-module mocks migrated)
]);

/**
 * Matches `vi.mock('x'` and the multi-line `vi.mock(\n  'x'` form. Only the
 * specifier matters — bare vs spread factories both leak, they just differ in
 * blast radius.
 */
const VI_MOCK_RE = /vi\.mock\(\s*['"]([^'"]+)['"]/g;

/**
 * ── SECOND RULE: no vi.mock of ANY internal module ──────────────────────────
 *
 * Aliased packages are only half the problem — a file-local `vi.mock` of an
 * INTERNAL module is hazardous too, in BOTH directions:
 *
 *   OUTWARD  the factory persists on the shared graph and poisons every later
 *            file importing that module. A bare factory also DELETES every
 *            export it omits, so two files mocking the same module with
 *            different subsets means whichever runs last wins.
 *   REVERSE  the `vi.mock` silently MISSES when an earlier file already
 *            imported the real module (that module's own test usually does),
 *            so the mock never takes effect and assertions see the real impl.
 *
 * This rule originally gated on FAN-IN ≥ 10, on the theory that blast radius
 * scales with the number of importers. That is true of the OUTWARD direction
 * only. The REVERSE direction bites at fan-in 1 — any module with its own test
 * already has a real importer — and it duly escaped the threshold and broke
 * `notify-deposit-paid` (fan-in 4). Fan-in is simply the wrong predictor for
 * half the problem, so the rule is now absolute.
 *
 * A blanket ban is affordable because the safe alternative costs the same to
 * write: a restored `vi.spyOn` is installed at RUN time (immune to load order)
 * and restored in `afterEach` (cannot leak outward). Fan-in is still computed,
 * but only as SEVERITY METADATA in the failure message.
 *
 * ESCAPE HATCH — for the rare case where `vi.spyOn` genuinely cannot work
 * (the module has import-time side effects that must be prevented, or an export
 * is non-configurable), tag the call site:
 *
 *     // mock-boundary-allow: <specific reason>
 *     vi.mock('./thing.js', () => ({ … }));
 *
 * Tags are deliberately constrained so they cannot become the new decay path
 * (guard comments in this repo decayed to 131 deep imports and 37 alias
 * violations before they were mechanised):
 *   - the reason is REQUIRED and must be non-trivial;
 *   - the total number of tags is CAPPED (`MAX_SUPPRESSIONS`), so adding one
 *     means removing another — the same shrink-only property a baseline has,
 *     but with the justification living at the call site where review sees it;
 *   - a STALE tag (one not sitting above an actual violation) fails, the
 *     analogue of ESLint's unused-disable-directive.
 */

/** Matches the escape-hatch tag and captures its reason. */
const ALLOW_TAG_RE = /\/\/\s*mock-boundary-allow:(.*)$/;

/**
 * Cap on escape-hatch tags. Lower this whenever one is removed; raising it
 * requires justifying the new suppression in review.
 */
const MAX_SUPPRESSIONS = 0;

/** A reason must be more than a shrug. */
const MIN_REASON_LENGTH = 12;

/** Relative `import`/`export … from`/dynamic-import specifiers. */
const REL_IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/** Resolve a relative specifier to a repo-relative `.ts` path (ESM `.js` → `.ts`). */
function resolveRelative(fromDir: string, spec: string): string {
  let p = path.resolve(fromDir, spec);
  if (p.endsWith('.js')) p = `${p.slice(0, -3)}.ts`;
  for (const cand of [p, `${p}.ts`, path.join(p, 'index.ts')]) {
    try {
      if (statSync(cand).isFile()) {
        return path.relative(REPO_ROOT, cand).replaceAll(path.sep, '/');
      }
    } catch {
      // not this candidate
    }
  }
  return path.relative(REPO_ROOT, p).replaceAll(path.sep, '/');
}

function collectAllTsFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectAllTsFiles(full, acc);
    else if (entry.endsWith('.ts')) acc.push(full);
  }
}

/** module (repo-relative) → number of NON-TEST source files importing it. */
function computeFanIn(): Map<string, number> {
  const all: string[] = [];
  collectAllTsFiles(FEATURES_SRC, all);
  const fanIn = new Map<string, number>();

  for (const file of all) {
    if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;
    const content = readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const seen = new Set<string>();
    REL_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null = REL_IMPORT_RE.exec(content);
    while (m !== null) {
      seen.add(resolveRelative(dir, m[1]));
      m = REL_IMPORT_RE.exec(content);
    }
    for (const target of seen) fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
  }
  return fanIn;
}

/** The line immediately above `offset`, trimmed (''  if `offset` is on line 1). */
function previousLine(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  if (lineStart === 0) return '';
  const prevStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  return source.slice(prevStart, lineStart - 1).trim();
}

interface InternalMock {
  /** `<module>::<repo-relative-test-path>` */
  key: string;
  /** how many non-test source files import the mocked module (severity only) */
  fanIn: number;
  /** the `mock-boundary-allow:` reason, if the call site is tagged */
  allowReason?: string;
}

/** Every `vi.mock` of an INTERNAL module, tagged or not. */
function findInternalMocks(): InternalMock[] {
  const files: string[] = [];
  collectTestFiles(FEATURES_SRC, files);
  const fanIn = computeFanIn();
  const found: InternalMock[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const relTest = path.relative(REPO_ROOT, file).replaceAll(path.sep, '/');
    VI_MOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null = VI_MOCK_RE.exec(content);
    while (match !== null) {
      const spec = match[1];
      if (spec.startsWith('.') && !isCommentLine(content, match.index)) {
        const target = resolveRelative(dir, spec);
        const tag = ALLOW_TAG_RE.exec(previousLine(content, match.index));
        found.push({
          key: `${target}::${relTest}`,
          fanIn: fanIn.get(target) ?? 0,
          ...(tag ? { allowReason: tag[1].trim() } : {}),
        });
      }
      match = VI_MOCK_RE.exec(content);
    }
  }
  return found;
}

/**
 * Is the line at `offset` a comment line?
 *
 * Several test files carry guard comments that deliberately QUOTE the forbidden
 * call (e.g. `// Do NOT add a file-local vi.mock(...) here`), and this very file
 * documents the pattern in its header. Matching those would baseline a comment —
 * and then deleting the helpful comment would trip the stale-baseline check.
 *
 * We check the line the match STARTS on (which is the `vi.mock(` line, even for
 * the multi-line form) and skip it if that line opens with `//`, `/*` or a
 * JSDoc continuation `*`. That covers every guard comment in the repo.
 *
 * Deliberately line-based rather than a comment-stripping state machine: a
 * machine that tracks string literals desyncs on regex literals containing
 * quote characters (this file has one), and a desync can silently swallow real
 * code — trading a visible false positive for an invisible FALSE NEGATIVE. A
 * missed violation is the one outcome this ratchet must never produce.
 */
function isCommentLine(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  let lineEnd = source.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = source.length;
  const line = source.slice(lineStart, lineEnd).trim();
  return line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');
}

/** Every `vi.mock` of a forbidden module, as `<specifier>::<repo-relative-path>`. */
function findViolations(): Set<string> {
  const files: string[] = [];
  collectTestFiles(FEATURES_SRC, files);

  const violations = new Set<string>();
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    VI_MOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null = VI_MOCK_RE.exec(content);
    while (match !== null) {
      const specifier = match[1];
      if (isForbidden(specifier) && !isCommentLine(content, match.index)) {
        const relPath = path
          .relative(REPO_ROOT, file)
          .replaceAll(path.sep, '/');
        violations.add(`${specifier}::${relPath}`);
      }
      match = VI_MOCK_RE.exec(content);
    }
  }
  return violations;
}

describe('architecture: no vi.mock of canonically-aliased modules', () => {
  const violations = findViolations();

  it('parsed a sane alias list out of vite.config.ts', () => {
    // Guard against the regex silently matching nothing (which would make the
    // whole ratchet pass vacuously if the config format ever changes).
    expect(
      ALIAS_PREFIXES.length + ALIAS_REGEXES.length,
      'Failed to parse the alias array from vite.config.ts — the `find:` format probably changed. Fix readAliasedSpecifiers().'
    ).toBeGreaterThanOrEqual(15);
  });

  it('has no vi.mock of an aliased module (except the baseline)', () => {
    const newViolations = [...violations]
      .filter((v) => !KNOWN_VIOLATIONS.has(v))
      .sort();

    expect(
      newViolations,
      `New vi.mock() of a canonically-aliased module.\nUnder isolate:false this factory persists on the SHARED module graph and\npoisons every later test file importing it — the file that fails will not\nbe this one, and it will change run-to-run.\n\nInstead: import the symbol and drive it with vi.mocked() in beforeEach, or\nuse a restored vi.spyOn for internal modules. If the canonical mock in\nsrc/__mocks__/ lacks an export you need, add it THERE.\n\nOffenders:\n  ${newViolations.join('\n  ')}`
    ).toEqual([]);
  });

  it('has no stale baseline entries (the ratchet may only shrink)', () => {
    const stale = [...KNOWN_VIOLATIONS]
      .filter((v) => !violations.has(v))
      .sort();

    expect(
      stale,
      `These baseline entries no longer exist — the mock has been migrated.\nDelete them from KNOWN_VIOLATIONS so they can never regress:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('architecture: no vi.mock of internal modules', () => {
  const found = findInternalMocks();

  it('computed a sane fan-in map', () => {
    // Fan-in is only severity metadata now, but if resolution silently broke
    // every score would read 0 and the failure messages would be misleading.
    // The shared barrel is imported by most of the package — a reliable canary.
    const fanIn = computeFanIn();
    expect(
      fanIn.get('packages/features/src/shared/index.ts') ?? 0,
      'Fan-in for shared/index.ts came out implausibly low — relative-import resolution is probably broken. Fix resolveRelative().'
    ).toBeGreaterThan(100);
  });

  it('has no untagged vi.mock of an internal module', () => {
    const offenders = found
      .filter((f) => f.allowReason === undefined)
      .map((f) => `${f.key}  (fan-in ${f.fanIn})`)
      .sort();

    expect(
      offenders,
      `vi.mock() of an INTERNAL module.\n\nUnder isolate:false the worker shares ONE module graph, so this is unsafe in\nboth directions: the factory leaks OUTWARD onto every later file importing\nthat module (a bare factory also deletes the exports it omits), and it\nsilently MISSES when an earlier file already imported the real module.\n\nUse a restored vi.spyOn instead — installed at run time, so load order does\nnot matter, and mockRestore() in afterEach stops it leaking:\n\n    import * as mod from './thing.js';\n    let spy: MockInstance;\n    beforeEach(() => { spy = vi.spyOn(mod, 'fn').mockResolvedValue(x); });\n    afterEach(() => { spy.mockRestore(); });\n\nIf spyOn genuinely cannot work (import-time side effects that must be\nprevented, or a non-configurable export), tag the call site AND raise\nMAX_SUPPRESSIONS in the same commit so the exception is visible in review:\n\n    // mock-boundary-allow: <specific reason>\n\n(fan-in shown per offender = how many source files import it, i.e. how far an\noutward leak would reach.)\n\nOffenders:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('every escape-hatch tag carries a real reason', () => {
    const weak = found
      .filter((f) => f.allowReason !== undefined)
      .filter((f) => (f.allowReason ?? '').length < MIN_REASON_LENGTH)
      .map((f) => `${f.key}  (reason: "${f.allowReason}")`)
      .sort();

    expect(
      weak,
      `A "mock-boundary-allow" tag needs a real justification (≥${MIN_REASON_LENGTH} chars)\nexplaining why vi.spyOn cannot be used here:\n  ${weak.join('\n  ')}`
    ).toEqual([]);
  });

  it('escape-hatch tags stay within the cap (the ratchet may only shrink)', () => {
    const tagged = found.filter((f) => f.allowReason !== undefined);

    expect(
      tagged.length,
      `There are ${tagged.length} "mock-boundary-allow" tags but MAX_SUPPRESSIONS is ${MAX_SUPPRESSIONS}.\nEvery suppression is a latent order-dependent flake. Migrate one to vi.spyOn,\nor — if this one is genuinely unavoidable — raise the cap in the same commit\nso the increase is visible in review.\nTagged:\n  ${tagged.map((f) => f.key).join('\n  ')}`
    ).toBeLessThanOrEqual(MAX_SUPPRESSIONS);
  });

  it('has no stale escape-hatch tags', () => {
    // The analogue of ESLint's unused-disable-directive: a tag that is not
    // sitting directly above a real violation is dead weight and, worse, reads
    // as sanctioned precedent for the next person.
    //
    // The architecture dir is skipped: THIS file quotes the tag verbatim in its
    // own documentation and failure messages, so scanning it makes the rule
    // flag its own docs. Architecture tests are static scanners — they never
    // mock anything — so there is nothing to police here anyway.
    const files: string[] = [];
    collectTestFiles(FEATURES_SRC, files);
    const stale: string[] = [];

    for (const file of files) {
      if (file.replaceAll(path.sep, '/').includes('/architecture/')) continue;
      const content = readFileSync(file, 'utf8');
      const rel = path.relative(REPO_ROOT, file).replaceAll(path.sep, '/');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (!ALLOW_TAG_RE.test(line)) return;
        const next = lines[i + 1] ?? '';
        if (!/vi\.mock\(\s*['"]\./.test(next)) {
          stale.push(`${rel}:${i + 1}`);
        }
      });
    }

    expect(
      stale,
      `These "mock-boundary-allow" tags do not sit directly above a vi.mock of an\ninternal module — the mock was migrated but the tag was left behind. Delete\nthem:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});
