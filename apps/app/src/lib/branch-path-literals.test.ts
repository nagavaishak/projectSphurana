import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BRANCH_PATHS } from './route-paths';

/**
 * The gate that stops branch-scoped URLs being spelled by hand.
 *
 * A literal like `'/dashboard/calendar/day'` still WORKS — the compatibility
 * splat (`routes/_authed/dashboard/$.tsx`) catches it and redirects into the
 * resolved branch. That is exactly what makes this worth gating: the failure is
 * invisible. The link lands on the right page, one redirect later, so nothing
 * looks broken and the literals accumulate until someone deletes the splat and
 * a hundred links 404 at once.
 *
 * Build them with `useRoutes()` / `useBranchRoutes()` / `useResolvedRoutes()`
 * instead. Those return the `/dashboard/l/:branch/...` form directly.
 *
 * SCOPE — this bans a branch-scoped path only in a NAVIGATION TARGET
 * (`to=`, `to:`, `href=`). That is deliberately narrower than "every
 * `/dashboard/` literal", which a naive reading of the plan (§4.2) would ban
 * and which would be wrong three times over:
 *
 *   - Route IDS (`createFileRoute('/_authed/dashboard/l/$locationId/…')`) are
 *     the file's own address, not a link.
 *   - ORG-LEVEL paths (`/dashboard/settings`, `/dashboard/account`) are not
 *     branch-scoped at all and are correct as literals — `ROUTES` holds them.
 *   - MATCHERS and the nav config hold the UN-PREFIXED form on purpose:
 *     `dashboard-nav.ts` stores `/dashboard/calendar/day` with
 *     `scope: 'location'` and `resolveNavUrl` adds the branch at render, and
 *     every active-state matcher compares against `stripBranchFromPath(...)`.
 *     Those are the mechanism, not a violation of it.
 *
 * A navigation target is the one position where an un-prefixed path silently
 * costs a redirect today and 404s the day the splat is deleted.
 */

const libDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(libDir, '../..');
const srcRoot = resolve(appRoot, 'src');

/** Files allowed to spell a branch-scoped path. */
const ALLOWED = new Set([
  // Defines them.
  'src/lib/route-paths.ts',
  // Builds the prefixed form from them.
  'src/lib/use-routes.ts',
  // This gate.
  'src/lib/branch-path-literals.test.ts',
  // Knows the URL shape.
  'src/features/organization-locations/branch-path.ts',
  'src/features/organization-locations/branch-path.test.ts',
]);

/**
 * Redirect SHIMS at the org level exist precisely to answer a legacy
 * branch-scoped path, so naming one is their whole job.
 */
function isRedirectShim(source: string): boolean {
  return (
    /redirectToBranch\(/.test(source) ||
    (/throw redirect\(/.test(source) && !/\bcomponent:/.test(source))
  );
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

/** Longest first, so `/dashboard/calendar/day` is reported over `/dashboard/calendar`. */
const BRANCH_LITERALS = [...new Set(Object.values(BRANCH_PATHS))].sort(
  (a, b) => b.length - a.length
);

describe('branch-scoped paths are built, not spelled', () => {
  const files = walk(srcRoot);

  it('finds the source tree (the gate must not pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(BRANCH_LITERALS.length).toBeGreaterThan(10);
  });

  it('has no hand-spelled branch-scoped path outside the allowed files', () => {
    const offenders: string[] = [];

    for (const full of files) {
      const rel = relative(appRoot, full).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;

      const source = readFileSync(full, 'utf8');
      if (isRedirectShim(source)) continue;

      for (const path of BRANCH_LITERALS) {
        // Only in a navigation target. Not a PREFIX of a longer path either —
        // `/dashboard/calendar` must not fire on `/dashboard/calendar/day`,
        // which is reported on its own.
        const inTarget = new RegExp(
          `(?:\\bto\\s*[:=]\\s*|\\bhref\\s*=\\s*)\\{?\\s*['"\`]${path}(?![\\w-])`
        );
        if (!inTarget.test(source)) continue;
        offenders.push(`${rel}  →  ${path}`);
        break;
      }
    }

    expect(
      offenders,
      `These spell a branch-scoped path by hand. It still works — the compatibility splat redirects it — which is why it needs a gate. Build it with useRoutes() / useBranchRoutes() / useResolvedRoutes() instead:\n${offenders
        .map((o) => `  - ${o}`)
        .join('\n')}`
    ).toEqual([]);
  });
});
