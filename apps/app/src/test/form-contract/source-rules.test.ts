import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two source-text rules, kept as cheap greps and folded in here so the whole
 * form story lives in one directory and reports as one thing.
 *
 * They are NOT redundant with the harness. The harness proves that the forms it
 * knows about behave; these prove that a NEW form can't be written in the shape
 * that causes the drift in the first place. Different question, and they cost
 * milliseconds instead of rendering a component tree:
 *
 *   1. WRITES LIVE IN HOOKS — a component that calls `apiClient.post/put/patch`
 *      is assembling a request body inline, which is how a second surface comes
 *      to assemble it differently. (`get`/`delete` are exempt: no body to drift.)
 *
 *   2. BODIES ARE BUILT BY BUILDERS — a component passing an object LITERAL into
 *      `mutate()` is doing the same thing one layer up. Under the shared-core
 *      pattern the component passes typed intent and the builder makes the body,
 *      so the argument is a variable, never a literal.
 *
 * Both are ratchets: the known offenders are baselined and the sets may only
 * shrink.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = resolve(appRoot, 'src');

/**
 * Pre-existing inline-write files, to be drained to zero. Do NOT add — route the
 * write through a mutation hook instead.
 */
const BASELINE_INLINE_WRITES = new Set<string>([
  // Admin / debug / infra — single-surface, low drift risk, drain last.
  'src/features/admin-terminal/components/impersonation-banner.tsx',
  'src/features/admin-terminal/components/organization-detail.tsx',
  'src/features/admin-terminal/components/two-factor-setup.tsx',
  'src/features/admin-terminal/components/two-factor-verify.tsx',
  'src/routes/_admin/admin/scraping.tsx',
  'src/routes/_authed/dashboard/debug/index.tsx',
  'src/features/terminal/lib/terminal-service.ts',
  'src/features/upload/api/resumable-upload.ts',
  'src/lib/push.ts',
  // Drift-relevant — owned by the form-contract worklist.
  'src/features/assistant/_components/rich/draft-reply-card.tsx',
  'src/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/test-call-card.tsx',
]);

/** Pre-existing inline-payload components, to be drained to zero. Never add. */
const BASELINE_INLINE_PAYLOADS = new Set<string>([
  'src/features/assistant/_components/composer.tsx',
  'src/features/claire/chat-preview/ad-preview-card.tsx',
  'src/features/claire/chat-preview/offer-preview-card.tsx',
  'src/routes/_authed/assistant/-components/composer.tsx',
  'src/routes/_authed/dashboard/l/$locationId/ai-assistant/-components/test-call-card.tsx',
]);

/**
 * The only files allowed to read `window.location.origin`.
 *
 * Not a drain-to-zero baseline — these three are correct forever, because they
 * are asking about the CURRENT DOCUMENT rather than about the app's public
 * address. Everything else wants `webAppUrl()`; see `@/lib/web-app-origin` for
 * why the two are not interchangeable on native.
 */
const ORIGIN_ALLOWED = new Set<string>([
  // Decides the app's public origin — the one place that must read the raw value.
  'src/lib/web-app-origin.ts',
  // Same-origin comparison for a post-auth redirect target (open-redirect guard).
  'src/lib/auth-redirect.ts',
  // Resolves the API base relative to the document actually being served.
  'src/lib/resolve-api-url.ts',
]);

const WRITE_CALL = /apiClient\.(post|put|patch)\b/;
const MUTATE_CALL = /\.(mutate|mutateAsync|execute|executeAsync)\(/g;

/** Strip comments so a doc comment mentioning `apiClient.put` isn't a hit. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const isHookFile = (path: string): boolean =>
  path.endsWith('.hook.ts') || /(^|\/)use-[^/]+\.ts$/.test(path);

const isTestFile = (path: string): boolean => /\.(test|spec)\.tsx?$/.test(path);

function passesInlineLiteral(src: string): boolean {
  for (const m of src.matchAll(MUTATE_CALL)) {
    const after = src.slice(m.index + m[0].length).replace(/^\s+/, '');
    if (after.startsWith('{')) return true;
  }
  return false;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(srcRoot).filter((f) => !isTestFile(f));

function ratchet(
  name: string,
  offenders: string[],
  baseline: Set<string>,
  advice: string
): void {
  it(`${name}: no new offenders`, () => {
    const unexpected = offenders.filter((f) => !baseline.has(f));
    expect(
      unexpected,
      `${advice}\n${unexpected.map((f) => `  - ${f}`).join('\n')}`
    ).toEqual([]);
  });

  it(`${name}: baseline only shrinks`, () => {
    const stale = [...baseline].filter((f) => !offenders.includes(f));
    expect(
      stale,
      `These are fixed — delete them from the baseline:\n${stale
        .map((f) => `  - ${f}`)
        .join('\n')}`
    ).toEqual([]);
  });
}

describe('form source rules', () => {
  describe('writes live in hooks', () => {
    const offenders = files
      .filter((f) => !isHookFile(f))
      .filter((f) => WRITE_CALL.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(appRoot, f));

    ratchet(
      'inline apiClient.post/put/patch',
      offenders,
      BASELINE_INLINE_WRITES,
      'These components build a request body inline. Move the write into a mutation hook\n' +
        "(and, if the operation has more than one UI surface, into that operation's shared\n" +
        'payload builder — see src/test/form-contract/registry.ts):'
    );
  });

  describe('outbound URLs use the public app origin', () => {
    const offenders = files
      .filter((f) => !ORIGIN_ALLOWED.has(relative(appRoot, f)))
      .filter((f) =>
        /window\.location\.origin/.test(stripComments(readFileSync(f, 'utf8')))
      )
      .map((f) => relative(appRoot, f));

    it('no window.location.origin outside the allowed files', () => {
      expect(
        offenders,
        `These build a URL from \`window.location.origin\`. In a browser that is the app
address, but inside the Capacitor WebView it is \`capacitor://localhost\` — a
well-formed URL that passes every \`z.string().url()\` on the way out and is then
rejected by Stripe as \`Not a valid URL\`, surfacing as a 500 and "sorry, try
again" on every native device. For shared links and QR codes it fails even more
quietly: a link nobody outside the device can open.

Use \`webAppUrl()\` / \`getWebAppOrigin()\` from \`@/lib/web-app-origin\` for any URL
that LEAVES the app. \`window.location.origin\` is only for comparing against the
current document's own origin (add such a file to ORIGIN_ALLOWED, with a why):
${offenders.map((f) => `  - ${f}`).join('\n')}`
      ).toEqual([]);
    });
  });

  describe('bodies are built by payload builders', () => {
    const offenders = files
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => passesInlineLiteral(readFileSync(f, 'utf8')))
      .map((f) => relative(appRoot, f));

    ratchet(
      'inline mutate({...}) literal',
      offenders,
      BASELINE_INLINE_PAYLOADS,
      'These components assemble the request body inline. Pass typed intent and let the\n' +
        "hook's payload builder make the body (docs/engineering/mutation-payload-pattern.md):"
    );
  });
});
