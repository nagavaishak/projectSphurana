import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Route inventory for the visual-regression project — DERIVED, not hand-kept.
 *
 * A hand-maintained list is the thing that rots: a new surface ships, nobody
 * adds it, and it is never visually covered. TanStack Router uses file-based
 * routing, so `apps/app/src/routes/` IS the route definition and is the source
 * of truth here. A new route enters the inventory the moment its file is
 * committed, and its first capture becomes a pending baseline for the one-time
 * human review.
 *
 * Deliberately NOT `routeTree.gen.ts`: that file is a BUILD ARTIFACT generated
 * by the Vite plugin and is gitignored (.gitignore:106), so it does not exist
 * in a fresh CI checkout — the first live run failed on exactly that. The route
 * files are tracked, are what the generator itself reads, and need no build
 * step to be correct.
 */

/**
 * Locate `apps/app/src/routes` by walking up from the working directory.
 *
 * Deliberately not `import.meta.dirname`: Playwright transpiles specs to CJS,
 * where `import.meta` is unavailable, and the runner's cwd differs between
 * `pnpm --filter app-e2e exec playwright test` (apps/app-e2e) and a repo-root
 * invocation with `--config`. Searching upward is correct under both.
 */
function findRoutesDir(): string {
  const candidates = [
    'apps/app/src/routes', // from the repo root
    '../app/src/routes', // from apps/app-e2e
  ];
  let dir = process.cwd();
  for (let up = 0; up < 5; up++) {
    for (const c of candidates) {
      const p = path.resolve(dir, c);
      if (existsSync(p)) return p;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `Could not locate apps/app/src/routes from ${process.cwd()}. The visual route inventory is derived from it — if apps/app's router moved, update findRoutesDir() in src/visual/routes.ts.`
  );
}

/** Every `.tsx` under the routes dir, as paths relative to it. */
function routeFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...routeFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * File-name conventions in TanStack's file-based routing, and why each is
 * dropped. These are EXCLUSIONS OF CAPABILITY, not of interest.
 */
function toUrl(relFile: string): string | null {
  let segs = relFile.replace(/\.tsx$/, '').split('/');

  // `-anything` is TanStack's marker for a directory/file that is NOT a route
  // (colocated components, hooks, helpers). `__root` is the app shell.
  if (segs.some((sg) => sg.startsWith('-') || sg.startsWith('__'))) return null;

  // `dashboard/l/$locationId/…` is the BRANCH prefix, and its `$locationId` is
  // not a "needs a seeded entity id" param in the PARAM_ROUTES sense — it is
  // the active branch, which the visual spec resolves at navigation time via
  // `branchUrl()`. Dropping the pair here yields the un-prefixed sub-path
  // (`/dashboard/calendar/week`), which is what the rest of the suite passes
  // around and what keeps snapshot filenames free of a per-run branch handle.
  //
  // Without this, EVERY branch-scoped surface — the calendar, sales, catalog,
  // clients, marketing, team, the lot — fell out of the inventory the moment
  // phase 3 moved it, leaving a list made largely of redirect shims.
  const branchAt = segs.findIndex(
    (sg, i) => sg === 'l' && segs[i - 1] === 'dashboard'
  );
  if (branchAt !== -1 && segs[branchAt + 1]?.startsWith('$')) {
    segs = [...segs.slice(0, branchAt), ...segs.slice(branchAt + 2)];
  }

  // Any REMAINING parameterised segment needs a seeded entity id — see
  // PARAM_ROUTES.
  if (segs.some((sg) => sg.includes('$'))) return null;
  // Tests colocated with routes are not routes.
  if (relFile.endsWith('.test.tsx')) return null;

  const url = segs
    // `_authed` / `_admin` are PATHLESS layouts: they wrap children for auth
    // but contribute nothing to the URL.
    .filter((sg) => !sg.startsWith('_'))
    // A trailing `index` addresses its parent path.
    .filter((sg, i, a) => !(sg === 'index' && i === a.length - 1))
    .join('/');

  return url ? `/${url}` : null;
}

/**
 * Every static (parameterless) dashboard route, read from the route files.
 *
 * Admin surfaces are excluded: they need an admin account the visual project
 * does not carry, so capturing them would only ever photograph a redirect.
 */
export function discoverStaticRoutes(): string[] {
  const dir = findRoutesDir();
  const routes = new Set<string>();

  for (const file of routeFiles(dir)) {
    const url = toUrl(file);
    if (!url) continue;
    if (!url.startsWith('/dashboard')) continue;
    routes.add(url);
  }

  return [...routes].sort();
}

/**
 * Public (unauthenticated) surfaces. Captured by the public visual spec with no
 * storageState, so a regression on the sign-in page cannot hide behind auth.
 */
export const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/forgot-password'];

/**
 * Routes that need a seeded entity id. The visual spec resolves each `:id` from
 * the deterministic seed before navigating, so detail surfaces are covered
 * without a hand-written url.
 *
 * Kept explicit (rather than derived from the `$param` routes) because each one
 * needs to know WHICH seeded entity to use, and that mapping cannot be inferred
 * from the route tree.
 */
export const PARAM_ROUTES: { path: string; seedKey: string }[] = [
  { path: '/dashboard/customers/:id', seedKey: 'clientId' },
  { path: '/dashboard/catalog/services/:id', seedKey: 'serviceId' },
];

/**
 * Routes that are known to be legitimately unstable or destructive to render,
 * with the REASON recorded. Anything skipped must be listed here so the
 * inventory's coverage is auditable — a silent skip is how coverage rots.
 */
export const SKIPPED_ROUTES: Record<string, string> = {
  '/dashboard/assistant':
    'Claire streams a live model response; covered by the Claire suite instead.',
};

/** The final capture inventory: discovered, minus explicitly skipped. */
export function visualRoutes(): string[] {
  return discoverStaticRoutes().filter((r) => !(r in SKIPPED_ROUTES));
}

/** Stable, filesystem-safe snapshot name for a route. */
export function snapshotName(route: string, viewport: string): string {
  const slug = route.replace(/^\//, '').replace(/\//g, '-') || 'root';
  return `${slug}-${viewport}.png`;
}
