import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "every Graph call goes through the HTTP seam".
 *
 * `packages/http`'s `fetchWithTimeout` is the single chokepoint for outbound
 * HTTP. `fetchWithRetry` / `fetchJsonWithRetry` both delegate to it. That one
 * function is where the E2E contract fake (`META_E2E_STUB`) installs its
 * interceptor, so a Graph call made with bare `fetch()` is INVISIBLE to the fake
 * and escapes to real Meta — on a stubbed preview, in CI, wherever.
 *
 * That is not hypothetical. Before this test existed, three Meta-bound call
 * sites bypassed the seam:
 *   - social-posts/publish-social-post  (a local re-implementation of the
 *     timeout wrapper — so every Facebook/Instagram PUBLISH escaped)
 *   - social-posts/fetch-page-media
 *   - apps/api testing.service `seedMetaAds`
 *
 * WHY THE RULE IS SCOPED TO GRAPH FILES
 * -------------------------------------
 * "No bare fetch anywhere" would be wrong — plenty of legitimate bare `fetch`
 * exists (image-generation downloading signed asset URLs, website-analysis
 * scraping, video-worker downloads). Those are not third-party API contracts we
 * need to intercept.
 *
 * So the enforceable rule is narrow and precise:
 *
 *   A file that references a Graph host must not call bare `fetch(`.
 *
 * A file is a "Graph file" if it mentions `GRAPH_API_BASE`,
 * `INSTAGRAM_*_BASE`, `INSTAGRAM_GRAPH_HOST`, `graph.facebook.com` or
 * `graph.instagram.com`.
 *
 * FIXING A FAILURE
 * ----------------
 * Import `fetchWithTimeout` (or `fetchWithRetry`) from
 * `@borradh-workspace/http` and call that instead. Pass `timeoutMs` explicitly
 * if the call site cares about the value. Do NOT add an exclusion.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../');

const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'packages/features/src'),
  path.join(REPO_ROOT, 'packages/integrations/src'),
  path.join(REPO_ROOT, 'apps/api/src'),
  path.join(REPO_ROOT, 'apps/video-worker/src'),
];

/**
 * Test/spec files legitimately stub `fetch` (`vi.stubGlobal('fetch', …)`) — that
 * IS how the contract tests capture outgoing payloads. Mocks likewise.
 */
const EXCLUDED_PATH_SEGMENTS = [
  '.test.ts',
  '.spec.ts',
  '/_integration/',
  '/__mocks__/',
];

/** Markers that identify a file as talking to the Graph API. */
const GRAPH_MARKERS = [
  'GRAPH_API_BASE',
  'INSTAGRAM_GRAPH_API_BASE',
  'INSTAGRAM_MESSAGING_API_BASE',
  'INSTAGRAM_OAUTH_API_BASE',
  'INSTAGRAM_GRAPH_HOST',
  'graph.facebook.com',
  'graph.instagram.com',
];

/**
 * A bare `fetch(` call — i.e. not `fetchWithTimeout(`, `fetchWithRetry(`,
 * `fetchJsonWithRetry(`, and not a property access like `page.request.fetch(`.
 *
 * The leading `[^\w.]` guard rejects both `xxxFetch(` and `obj.fetch(`.
 */
const BARE_FETCH = /(^|[^\w.])fetch\s*\(/;

/**
 * Blank out comments and string literals so a `fetch(` mentioned in prose or
 * inside a string doesn't register as a call.
 *
 * Every replacement PRESERVES NEWLINES — blanking a multi-line block comment or
 * template literal to `''` would shift every subsequent line index and make the
 * reported line numbers wrong (they were, by ~20 and ~145 lines, before this
 * was fixed). A fitness test that points at the wrong line wastes the reader's
 * time at exactly the moment they're trying to fix something.
 */
function blankPreservingLines(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankPreservingLines)
    .replace(/\/\/[^\n]*/g, blankPreservingLines)
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, blankPreservingLines)
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, blankPreservingLines)
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, blankPreservingLines);
}

function isExcluded(file: string): boolean {
  return EXCLUDED_PATH_SEGMENTS.some((seg) => file.includes(seg));
}

function collectTsFiles(dir: string, acc: string[]): void {
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
      collectTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !isExcluded(full)) {
      acc.push(full);
    }
  }
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findViolations(): Violation[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectTsFiles(root, files);

  const violations: Violation[] = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    if (!GRAPH_MARKERS.some((m) => raw.includes(m))) continue;

    // Scan line by line so the failure message can point at a line number, but
    // strip comments/strings first so a `fetch(` inside prose doesn't trip it.
    const codeLines = stripNonCode(raw).split('\n');
    codeLines.forEach((code, i) => {
      if (BARE_FETCH.test(code)) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: i + 1,
          text: raw.split('\n')[i]?.trim() ?? '',
        });
      }
    });
  }

  return violations;
}

describe('architecture: outbound HTTP seam', () => {
  it('no Graph-calling file uses bare fetch()', () => {
    const violations = findViolations();

    const detail = violations
      .map((v) => `  ${v.file}:${v.line}\n      ${v.text}`)
      .join('\n');

    const message = [
      'These files call the Graph API with bare fetch(), so the E2E contract fake cannot intercept them and they escape to real Meta:',
      '',
      detail,
      '',
      "Fix: import { fetchWithTimeout } from '@borradh-workspace/http' and call that instead (pass timeoutMs if the call site cares). Do not add an exclusion.",
    ].join('\n');

    expect(violations, violations.length === 0 ? '' : message).toEqual([]);
  });

  it('detects a bare fetch in a Graph file (guards the detector itself)', () => {
    // A fitness test that can never fail is worthless. Prove the matcher fires
    // on the shape it is meant to catch, and stays quiet on the seam helpers.
    expect(BARE_FETCH.test('const r = await fetch(url);')).toBe(true);
    expect(BARE_FETCH.test('return fetch(`${GRAPH_API_BASE}/me`);')).toBe(true);

    expect(BARE_FETCH.test('await fetchWithTimeout(url, {});')).toBe(false);
    expect(BARE_FETCH.test('await fetchWithRetry(url, {});')).toBe(false);
    expect(BARE_FETCH.test('await fetchJsonWithRetry(url);')).toBe(false);
    expect(BARE_FETCH.test('await page.request.fetch(url);')).toBe(false);
    expect(BARE_FETCH.test('await metaFetch(url, {});')).toBe(false);
  });

  it('reports accurate line numbers (stripping preserves line count)', () => {
    // Regression: blanking multi-line comments/templates to '' shifted every
    // later line index, so violations were reported ~20 and ~145 lines off.
    const source = [
      'const a = 1;',
      '/* a block',
      '   comment that',
      '   spans lines */',
      'const t = `a template',
      '  spanning lines`;',
      'const r = await fetch(url);', // line 7
    ].join('\n');

    const stripped = stripNonCode(source);
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);

    const hit = stripped.split('\n').findIndex((line) => BARE_FETCH.test(line));
    expect(hit + 1).toBe(7);
  });

  it('ignores fetch( mentioned only in a comment or string', () => {
    const source = [
      '// we used to call fetch(url) here',
      'const doc = "call fetch(x) to do it";',
      'const ok = await fetchWithTimeout(url);',
    ].join('\n');

    const hits = stripNonCode(source)
      .split('\n')
      .filter((line) => BARE_FETCH.test(line));
    expect(hits).toEqual([]);
  });
});
