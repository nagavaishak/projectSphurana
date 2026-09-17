import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

/**
 * Read straight from the environment rather than importing `API_URL` from
 * `seed.fixture.ts`: the seed fixture imports `branchUrl` from here, and the
 * resulting ESM cycle would leave `API_URL` in its temporal dead zone whenever
 * this module happened to be evaluated first. Same value, no cycle.
 */
const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * Branch-scoped URLs: turning `/dashboard/calendar` into
 * `/dashboard/l/<branch>/calendar`.
 *
 * Every branch-scoped surface now lives under `/dashboard/l/:branch/…`, where
 * `:branch` is the location's SLUG when it has one and its id otherwise (the
 * app calls that its "handle" — `branchHandle()` in
 * `apps/app/src/features/organization-locations/branch-path.ts`).
 *
 * The app still ships a compatibility SPLAT that catches a legacy
 * `/dashboard/calendar` and redirects it into the resolved branch, so the old
 * paths are not broken — each just costs an extra navigation, and the whole
 * point of the splat is that it is temporary. Resolving the branch here means
 * the suite exercises the URLs the app actually produces, and stops depending
 * on a route that is scheduled for deletion.
 *
 * Nothing here hardcodes a branch id: the handle is read per browser context
 * from `GET /organization-locations`, using the SAME precedence the app's
 * `resolveEntryBranch()` uses (primary, else the first by `sortOrder`).
 */

/**
 * Which top-level `/dashboard/x` segments are branch-scoped — DERIVED from the
 * router, not hand-kept.
 *
 * `apps/app/src/routes/_authed/dashboard/l/$locationId/` IS the definition of
 * "branch-scoped", so reading it means a surface that moves under the branch
 * prefix is picked up the moment its route file lands, instead of silently
 * falling through to the splat until someone notices. Same reasoning, and the
 * same directory-walk, as the visual project's route inventory
 * (`src/visual/routes.ts`).
 */
function findBranchRoutesDir(): string {
  const candidates = [
    'apps/app/src/routes/_authed/dashboard/l/$locationId',
    '../app/src/routes/_authed/dashboard/l/$locationId',
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
    `Could not locate the branch route directory from ${process.cwd()}. Branch-scoped routes live in apps/app/src/routes/_authed/dashboard/l/$locationId — if that moved, update findBranchRoutesDir() in src/fixtures/branch.fixture.ts.`
  );
}

let branchSegmentsCache: Set<string> | undefined;

/** The set of first path segments that live under `/dashboard/l/:branch/`. */
export function branchScopedSegments(): Set<string> {
  if (branchSegmentsCache) return branchSegmentsCache;
  const dir = findBranchRoutesDir();
  const segments = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `-foo` is TanStack's marker for a colocated non-route file.
    if (entry.name.startsWith('-') || entry.name.startsWith('_')) continue;
    // `customers.$leadId.tsx` and `customers.tsx` both describe `customers`.
    const seg = entry.name.replace(/\.tsx$/, '').split('.')[0];
    if (seg.length === 0 || seg.startsWith('$')) continue;
    segments.add(seg);
  }
  if (segments.size === 0) {
    throw new Error(
      `Found no branch-scoped route segments in ${dir}. That is almost certainly a broken path rather than a real empty directory — see findBranchRoutesDir().`
    );
  }
  branchSegmentsCache = segments;
  return segments;
}

/** One entry of `GET /organization-locations`, as this fixture reads it. */
interface BranchRow {
  id: string;
  slug?: string | null;
  isPrimary?: boolean | null;
}

/**
 * Cached per BROWSER CONTEXT, not per page or per worker: the context is what
 * carries the session cookie, so it is exactly the scope over which "which org
 * am I, and therefore which branch" is a constant. A worker-level cache would
 * leak the bare org's branch into a connected-org test in the same worker.
 */
const handleByContext = new WeakMap<BrowserContext, Promise<string | null>>();

/**
 * Why the last resolution attempt came back empty-handed, for the error
 * `branchUrl()` raises. A module-level string rather than a richer return type
 * because there is exactly one resolution in flight per context and the value
 * is only ever read to build a message.
 */

/**
 * The org the bare storage state was prepared for, recorded by `setup-bare`.
 *
 * Active organization is SERVER-side session state and the bare session is
 * SHARED by every spec in the lane, so one spec calling
 * `POST /organization/active` to work on an org of its own re-points it for all
 * the others. `GET /organization-locations` then answers for that org — `200
 * []` when it has no branch — and every branch-scoped URL in the neighbouring
 * spec silently loses its handle. It presented as a different spec failing each
 * run, which is why it read as flake for so long.
 *
 * Returns null when the file is absent, which is the normal case for the
 * connected and per-test-org projects: they have their own sessions and must
 * not be dragged onto the bare org.
 */
function recordedBareOrgId(): string | null {
  for (const candidate of [
    '.auth/bare-org.json',
    '../app-e2e/.auth/bare-org.json',
  ]) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        organizationId?: string;
      };
      return parsed.organizationId ?? null;
    } catch {
      // A malformed file must not take the suite down — fall through to null
      // and let the caller report the empty list as it would have anyway.
    }
  }
  return null;
}

let lastResolveFailure = '';

/**
 * Whether the last resolution failed because the session is SIGNED OUT.
 *
 * That is not a broken precondition, it is a legitimate state some specs are
 * deliberately in — `smoke.spec.ts` asserts an unauthenticated visitor gets
 * redirected to sign-in, and asks for a branch URL to do it. For those the
 * un-prefixed path is the right answer and throwing is wrong. Every OTHER way
 * of failing to resolve still throws.
 */
let lastResolveWasUnauthenticated = false;

async function fetchBranchHandle(page: Page): Promise<string | null> {
  // RETRIED, because the old degrade was invisible and expensive.
  //
  // One failed — or momentarily empty — read here used to poison the whole
  // browser context: the handle is cached, every later `branchUrl()` returned
  // the un-prefixed path, those hit the compatibility splat, and the splat
  // answers an unresolved branch with a redirect to `/dashboard/locations`
  // (`routes/_authed/dashboard/$.tsx`). The test then failed several steps
  // later on `expect(page).toHaveURL(...)` reporting "/dashboard/locations",
  // naming neither the request that failed nor the redirect that followed.
  //
  // That is exactly how `mobile-navigation.spec.ts` failed across branches: a
  // different subset of the shell-behaviour tests each run, all of them landing
  // on the location picker.
  //
  // The empty list is retried too, not just the transport error: an org whose
  // locations are not visible yet reads identically to one that has none, and
  // only time tells them apart.
  const attempts = 4; // one extra so the org-drift repair below still gets retries
  lastResolveFailure = '';
  lastResolveWasUnauthenticated = false;
  let repairedActiveOrg = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await page.request.get(
        `${API_URL}/organization-locations`,
        { timeout: 60_000 }
      );

      if (response.ok()) {
        const body = (await response.json()) as { items?: BranchRow[] };
        const items = body.items ?? [];
        if (items.length > 0) {
          // Same precedence as the app's `resolveEntryBranch()`: primary, else
          // first. (The app checks a remembered id ahead of both; a test starts
          // with none.)
          const branch = items.find((l) => l.isPrimary) ?? items[0];
          return branch.slug ?? branch.id;
        }
        // An empty list is usually not "this org has no branches" — it is
        // "the session is pointed at somebody else's org". Put it back and
        // ask again before believing the answer.
        const expectedOrgId = recordedBareOrgId();
        if (expectedOrgId && !repairedActiveOrg) {
          repairedActiveOrg = true;
          const active = (await page.request
            .get(`${API_URL}/organization/active`, { timeout: 60_000 })
            .then((r) => (r.ok() ? r.json() : null))
            .catch(() => null)) as { id?: string } | null;

          if (active?.id !== expectedOrgId) {
            console.warn(
              `[branch.fixture] the shared session had drifted to org ${
                active?.id ?? 'unknown'
              }; restoring ${expectedOrgId}. Some spec in this lane re-pointed it with POST /organization/active.`
            );
            await page.request
              .post(`${API_URL}/organization/active`, {
                data: { organizationId: expectedOrgId },
                timeout: 60_000,
              })
              .catch(() => null);
            continue; // re-read the list on the restored org
          }
        }

        lastResolveFailure =
          'the API returned an EMPTY location list on a 200, and the session ' +
          'was already on the expected org — so this org genuinely has no ' +
          'branches and setup-bare should have created one.';
      } else if (response.status() === 401 || response.status() === 403) {
        // Not a hiccup — an answer, and often the intended one. Retrying
        // cannot change a permission.
        lastResolveWasUnauthenticated = true;
        lastResolveFailure = `the API answered ${response.status()}: this session is not authenticated for organization-locations, so the stored auth state is missing, expired, or has no active organization.`;
        return null;
      } else {
        lastResolveFailure = `the API answered HTTP ${response.status()}.`;
      }
    } catch (error) {
      lastResolveFailure = `the request threw: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (attempt < attempts) {
      // A plain timer, NOT `page.waitForTimeout` (which the lint rule bans, and
      // rightly): this backs off between HTTP attempts against the API, rather
      // than blindly sleeping for the app to settle.
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  return null;
}

/**
 * The active branch's URL handle for this page's session, or `null` when it
 * cannot be resolved (not signed in yet, or an org with no locations).
 */
export async function branchHandleFor(page: Page): Promise<string | null> {
  const context = page.context();
  const cached = handleByContext.get(context);
  if (cached) return cached;
  const pending = fetchBranchHandle(page);
  handleByContext.set(context, pending);
  return pending;
}

/**
 * Forget the cached handle for this page's context.
 *
 * Needed by any test that changes WHICH org or branch the session is in
 * mid-test (sign out and back in as someone else, create a location and switch
 * to it) — otherwise the stale handle would be pasted into every later URL.
 */
export function resetBranchHandle(page: Page): void {
  handleByContext.delete(page.context());
}

/**
 * Rewrite a legacy `/dashboard/<segment>/…` path into its branch-scoped form.
 *
 * Leaves alone: org-level paths (`/dashboard/settings`, `/dashboard/account`,
 * `/dashboard/more`, …), paths that are already branch-scoped, bare
 * `/dashboard` (which resolves its own branch), and anything outside
 * `/dashboard`. Falls back to the input unchanged when no branch resolves, so a
 * signed-out navigation still behaves as it did.
 */
export async function branchUrl(page: Page, url: string): Promise<string> {
  const [pathname, ...rest] = url.split(/(?=[?#])/);
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'dashboard') return url;
  const first = segments[1];
  if (!first || first === 'l') return url;
  if (!branchScopedSegments().has(first)) return url;

  const handle = await branchHandleFor(page);
  if (!handle) {
    // Signed out: the caller is a spec that means to be. Hand back the
    // un-prefixed path exactly as before — it is testing the redirect, not a
    // branch.
    if (lastResolveWasUnauthenticated) return url;

    // FAIL HERE, not three steps later.
    //
    // Handing back `url` unchanged looks harmless and is not: the un-prefixed
    // path hits the compatibility splat, which cannot resolve a branch either
    // and redirects to `/dashboard/locations`. The spec then dies on some later
    // `toHaveURL` naming the picker, which is why this lane produced a
    // different-looking failure every run.
    //
    // Failing here also matches the suite's own rule: a missing precondition is
    // seeded or failed, never quietly worked around.
    throw new Error(
      `branchUrl(${url}): no active branch resolved, so this would have used the un-prefixed path and been redirected to /dashboard/locations. Reason: ${lastResolveFailure || 'unknown — handle was null with no recorded cause.'}`
    );
  }
  return `/dashboard/l/${handle}/${segments.slice(1).join('/')}${rest.join('')}`;
}

/**
 * A `toHaveURL` matcher for a branch-scoped path, with the branch left open.
 *
 * `expect(page).toHaveURL(/\/dashboard\/team\/members/)` cannot simply keep
 * its literal: the branch segment now sits between `/dashboard/` and the
 * sub-path, and the handle differs per org and per run. Wildcarding just that
 * segment keeps the assertion about the surface the user landed on, which is
 * what the test meant.
 *
 * `subPathSource` is REGEX SOURCE, not a literal, so an assertion that was
 * anchored or parameterised stays that way:
 *   branchUrlPattern('home$')            → /\/dashboard\/l\/[^/]+\/home$/
 *   branchUrlPattern('customers/[^/]+$') → …/customers/<id> and nothing deeper
 */
export function branchUrlPattern(subPathSource: string): RegExp {
  const normalised = subPathSource.startsWith('/')
    ? subPathSource.slice(1)
    : subPathSource;
  return new RegExp(`/dashboard/l/[^/]+/${normalised}`);
}
