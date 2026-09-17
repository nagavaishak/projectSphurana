import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "api-client only takes VALUES from frontend-safe barrels".
 *
 * api-client is bundled for the browser (and for mobile). A `import type {...}`
 * from a feature domain barrel is free — types are erased at build. A VALUE
 * import from the same barrel is not: it makes the bundler pull the domain's
 * whole server-side chain, which for most domains reaches
 * `@borradh-workspace/database` (and `postgres`) or `observability` (and
 * `@logtail/node`). Those import `node:path` / `node:fs`, which Vite
 * externalises to `__vite-browser-external`, and the app build dies with
 * something like:
 *
 *     "dirname" is not exported by "__vite-browser-external"
 *
 * The failure surfaces only in a full production app build — every typecheck
 * and unit test passes — so it is easy to merge and expensive to diagnose.
 * `packages/features/src/shared/public.ts` exists precisely to be the safe
 * doorway; enum values and other runtime constants belong there.
 *
 * This test statically scans api-client sources and fails on any non-type
 * import of a `@borradh-workspace/features/<domain>` barrel.
 */

const SRC_DIR = path.resolve(__dirname);

/**
 * Subpaths of `@borradh-workspace/features` curated to be safe in a browser
 * bundle. `shared` resolves to `shared/public.ts`, which deliberately excludes
 * anything reaching `database` or `node:crypto`.
 */
const BROWSER_SAFE_SUBPATHS: ReadonlySet<string> = new Set(['shared']);

/**
 * A `<domain>/models` subpath is by convention a pure types-and-constants leaf
 * (labels, enum value arrays), split out from the domain barrel exactly so the
 * frontend can reach it without the services — see
 * `features/recommendations/models`, whose consumer notes the services pull
 * `@sentry/node`. Values may come from these.
 */
const isCuratedModelsLeaf = (subpath: string) => subpath.endsWith('/models');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * Matches an ES import statement, capturing whether it is type-only and which
 * module it targets. `import type X` and `import type { X }` are both erased,
 * so both are allowed; `import { type X, y }` is NOT — `y` is a real value.
 */
const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;

describe('architecture: api-client is browser-safe', () => {
  const files = collectSourceFiles(SRC_DIR);

  it('found the api-client sources at all', () => {
    // Guards against a bad refactor making this test vacuously pass.
    expect(files.length).toBeGreaterThan(10);
  });

  it('never takes a runtime value from a feature domain barrel', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(IMPORT_RE)) {
        const isTypeOnlyImport = Boolean(match[1]);
        const clause = match[2] ?? '';
        const moduleSpecifier = match[3] ?? '';

        if (isTypeOnlyImport) continue;
        if (!moduleSpecifier.startsWith('@borradh-workspace/features'))
          continue;

        const subpath = moduleSpecifier
          .replace('@borradh-workspace/features', '')
          .replace(/^\//, '');
        if (BROWSER_SAFE_SUBPATHS.has(subpath)) continue;
        if (isCuratedModelsLeaf(subpath)) continue;

        // `import { type A, type B } from '...'` is fully erased too.
        const named = clause.replace(/[{}]/g, '').trim();
        const specifiers = named
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const everySpecifierIsType =
          specifiers.length > 0 &&
          specifiers.every((s) => s.startsWith('type '));
        if (everySpecifierIsType) continue;

        violations.push(
          `${path.relative(SRC_DIR, file)} takes a runtime value from "${moduleSpecifier}" — re-export it from @borradh-workspace/features/shared (shared/public.ts) instead.`
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
