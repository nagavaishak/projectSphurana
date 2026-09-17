import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripBranchFromPath } from '@/features/organization-locations/branch-path';

import { BRANCH_PATHS } from '@/lib/route-paths';
import {
  dashboardAssistantSection,
  dashboardNavSections,
  filterNavForBookingDestination,
  findDashboardNavSection,
  isDashboardNavItemActive,
  isDashboardSectionActive,
  resolveNavUrl,
} from './dashboard-nav';
import { ROUTES } from './route-paths';

const APP_SRC = resolve(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------------------
// The gate's input is DERIVED from the generated route tree, not hand-written.
//
// This test used to assert a hardcoded list of 14 `ROUTES` constants, so a new
// route was never checked for nav reachability and dead entries accumulated
// unnoticed. Now every `/dashboard/*` leaf TanStack generates must resolve to
// exactly one of:
//
//   1. reachable from a nav section (a `section.match` prefix covers it), or
//   2. a redirect shim — detected by READING the route file, not by listing it, or
//   3. an explicit UNREACHABLE_BY_DESIGN entry with a written reason.
//
// Add a `/dashboard/*` route and forget the nav, and this goes red.
// ---------------------------------------------------------------------------

/** Every `to`-navigable full path TanStack generated, filtered to the dashboard. */
function dashboardLeavesFromRouteTree(): string[] {
  const gen = readFileSync(join(APP_SRC, 'routeTree.gen.ts'), 'utf8');
  const start = gen.indexOf('export interface FileRoutesByTo {');
  if (start === -1) {
    throw new Error(
      'routeTree.gen.ts has no FileRoutesByTo — the generator changed shape, so ' +
        'this gate is no longer reading the route tree. Fix the parse; do not ' +
        'delete the assertion.'
    );
  }
  const block = gen.slice(start, gen.indexOf('\n}', start));
  const leaves = [...block.matchAll(/^\s*'([^']+)':/gm)]
    .map((m) => m[1])
    .filter((p) => p === '/dashboard' || p.startsWith('/dashboard/'));

  if (leaves.length < 50) {
    throw new Error(
      `Parsed only ${leaves.length} dashboard routes out of the generated tree — the parse is broken, so this gate would pass vacuously.`
    );
  }
  return leaves;
}

/**
 * routeId (verbatim, e.g. `/_authed/dashboard/socials/post/$id` or the index
 * form `/_authed/dashboard/`) → source text. Ids are NOT normalised: a layout
 * (`dashboard.tsx` → `/_authed/dashboard`) and its index (`dashboard/index.tsx`
 * → `/_authed/dashboard/`) are different routes and must not collide.
 */
function routeSourceById(): Map<string, string> {
  const byId = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.tsx')) {
        const src = readFileSync(full, 'utf8');
        const id = src.match(/createFileRoute\(\s*'([^']+)'/)?.[1];
        if (id) byId.set(id, src);
      }
    }
  };
  walk(join(APP_SRC, 'routes'));
  return byId;
}

/**
 * A `to` path resolves to the INDEX route where one exists (that is the thing
 * `to` actually lands on), otherwise to the leaf route file.
 */
function sourceFor(
  sources: Map<string, string>,
  pathname: string
): string | undefined {
  return (
    sources.get(`/_authed${pathname}/`) ?? sources.get(`/_authed${pathname}`)
  );
}

/**
 * A legacy alias kept so old links and bookmarks don't 404: it renders nothing
 * and bounces to the live path. Not a destination, so it must NOT be in the nav.
 * DERIVED from the file — a new shim needs no edit here.
 */
function isRedirectShim(src: string): boolean {
  // `redirectToBranch` is the shim form for routes that moved under the branch
  // prefix: it resolves the branch and throws the redirect inside a helper, so
  // the literal `throw redirect(` never appears in the route file. Without this
  // arm every one of those shims reads as an orphaned page.
  const redirects =
    /throw redirect\(/.test(src) || /redirectToBranch\(/.test(src);
  return redirects && !/\bcomponent:/.test(src);
}

/**
 * Layout routes render an `<Outlet />` and nothing else — they are a URL
 * segment, not a destination, so "reachable from the nav" is not a question
 * that applies to them. `/dashboard/l/$locationId` is the branch layout.
 */
function isLayoutRoute(src: string): boolean {
  return /<Outlet \/>/.test(src) && !/throw redirect\(/.test(src);
}

/**
 * Wireframe routes under `/dashboard/wireframes/` are review scaffolding, not
 * product destinations: static fixtures, no backend, and nothing in the product
 * links to them — that is the point of them. Each one is deleted when its
 * surface ships for real.
 *
 * They are excluded as a CLASS rather than as individual UNREACHABLE_BY_DESIGN
 * entries, because that list is for shipped pages that are deliberately
 * unlinked and it is meant to shrink. Twenty throwaway review pages would bury
 * the handful of real entries it exists to hold.
 *
 * If `/dashboard/wireframes/` still has routes in it once the surfaces have
 * shipped, deleting them is the fix — not moving them into the list below.
 */
function isWireframeRoute(pathname: string): boolean {
  return pathname.startsWith('/dashboard/wireframes');
}

/**
 * Destinations that exist and are deliberately NOT in the nav. Every entry needs
 * a reason a human reads in review. This list should only ever shrink — by
 * deleting the route or putting it in the nav. Never add an entry to get green.
 */
const UNREACHABLE_BY_DESIGN: Record<string, string> = {
  '/dashboard/deposits':
    'Placeholder page — renders a "Coming Soon" empty state and nothing else. Deliberately unlinked until deposits ship. Delete it or ship it.',
  '/dashboard/website':
    'The microsite editor. Built and working, but not a product we expose — it was pulled out of the nav entirely rather than shipped preview-only. The route guards itself: website.tsx redirects to Home in production and microsite-editor.guard.ts 404s the API, so this is not the only thing keeping it shut. Ship it or delete it.',
  '/dashboard/reset':
    'Internal dev/QA utility that resets org state. Must never appear in customer nav.',
  '/dashboard/voice-test':
    'Internal dev harness for the voice agent. Must never appear in customer nav.',
  '/dashboard/template-preview':
    'Internal dev harness for previewing video templates. Must never appear in customer nav.',
  '/dashboard/debug':
    'Internal connectivity/debug panel. Must never appear in customer nav.',
  '/dashboard/debug/analysis-split-test':
    'Internal debug panel for the asset-analysis split test. Must never appear in customer nav.',
  '/dashboard/notifications':
    "The notifications FEED, reached from the More grid's personal cards (PERSONAL_CARDS in more/index.tsx). Those two cards — Profile and Notifications — are declared on the More page rather than in dashboardNavSections because that config also drives the DESKTOP sidebar, where both already live in the rail footer; listing them there would show each twice on desktop to fix a mobile-only gap.",
  '/dashboard/more':
    'The mobile "More" tab itself — reached from the bottom tab bar, and its content IS dashboardNavSections. Listing it inside the nav would be circular.',
  '/dashboard/more/$section':
    'Drill-down of the mobile "More" tab; it enumerates one section of dashboardNavSections.',
  '/dashboard/videos/create-from-client':
    'Wizard entered from the Create Video launcher (/create-video links straight to it). A flow, not a destination.',
  '/dashboard/content-calendar':
    'Layout for the calendar views the Socials planner embeds — planner-calendar renders ClientContainer with basePath="/dashboard/content-calendar", so its day/week cells link in here. Reachable only through Marketing > Socials. SUSPECT: ROUTES.contentCalendar now points at /dashboard/marketing/socials, so this tree looks like a half-finished migration.',
  '/dashboard/content-calendar/day':
    'A view of the planner calendar the Socials page links into — see /dashboard/content-calendar.',
  '/dashboard/content-calendar/three-day':
    'A view of the planner calendar the Socials page links into — see /dashboard/content-calendar.',
  '/dashboard/content-calendar/week':
    'A view of the planner calendar the Socials page links into — see /dashboard/content-calendar.',
  '/dashboard/content-calendar/month':
    'A view of the planner calendar the Socials page links into — see /dashboard/content-calendar.',
};

function isReachableFromNav(pathname: string): boolean {
  return dashboardNavSections.some((section) =>
    isDashboardSectionActive(section, pathname)
  );
}

describe('dashboard route reachability (derived from routeTree.gen.ts)', () => {
  const leaves = dashboardLeavesFromRouteTree();
  const sources = routeSourceById();

  it('resolves every generated dashboard route to its source file', () => {
    // If this fails, the id→file mapping is broken — and the shim detection below
    // would then silently misclassify real pages. The gate must not pass vacuously.
    const unresolved = leaves.filter((p) => !sourceFor(sources, p));
    expect(unresolved).toEqual([]);
  });

  it('every /dashboard/* route is in the nav, a redirect shim, or explicitly exempt', () => {
    const orphans = leaves.filter((rawPathname) => {
      // Exemptions are keyed by the UN-PREFIXED path, like the nav itself —
      // "this page is deliberately unlinked" is a fact about the page, not
      // about which branch you reached it from.
      const pathname = stripBranchFromPath(rawPathname);
      if (isReachableFromNav(pathname)) return false;
      if (isWireframeRoute(pathname)) return false;
      if (pathname in UNREACHABLE_BY_DESIGN) return false;
      // Source lookup keys off the REAL route id, not the normalised one.
      const src = sourceFor(sources, rawPathname);
      if (src && isLayoutRoute(src)) return false;
      return !(src && isRedirectShim(src));
    });

    expect(
      orphans,
      'These dashboard routes are reachable from nowhere. Put them in a nav section, ' +
        'delete them, or add an UNREACHABLE_BY_DESIGN entry with a reason.'
    ).toEqual([]);
  });

  it('has no stale UNREACHABLE_BY_DESIGN entries', () => {
    const comparableLeaves = leaves.map(stripBranchFromPath);
    const stale = Object.keys(UNREACHABLE_BY_DESIGN).filter(
      (pathname) =>
        !comparableLeaves.includes(pathname) || isReachableFromNav(pathname)
    );
    expect(
      stale,
      'These exemptions no longer apply — the route was deleted, or it is now in the nav.'
    ).toEqual([]);
  });

  it('gives every exemption a written reason', () => {
    for (const [pathname, reason] of Object.entries(UNREACHABLE_BY_DESIGN)) {
      expect(reason.length, `${pathname} needs a real reason`).toBeGreaterThan(
        20
      );
    }
  });

  it('points every nav destination at a route that exists', () => {
    // Nav destinations for branch-scoped entries are written UN-PREFIXED
    // (`/dashboard/calendar/day`), because one nav config serves every branch.
    // The generated leaves carry the literal `$locationId` segment, so they are
    // normalised to the same shape before comparing — the gate stays exact, it
    // just compares like with like.
    const comparableLeaves = leaves.map(stripBranchFromPath);
    const destinations = dashboardNavSections.flatMap((section) => [
      section.url,
      ...(section.items ?? []).map((item) => item.url),
    ]);
    const dead = destinations.filter((url) => !comparableLeaves.includes(url));
    expect(dead, 'Nav entries pointing at routes that do not exist.').toEqual(
      []
    );
  });
});

/**
 * The More tab renders one card per section and drills into its items, so this
 * config is the whole mobile navigation surface. If a destination isn't in
 * here, it is unreachable on a phone.
 */
describe('dashboardNavSections', () => {
  it('has a unique, resolvable slug per section', () => {
    const slugs = dashboardNavSections.map((section) => section.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const slug of slugs) {
      expect(findDashboardNavSection(slug)?.slug).toBe(slug);
    }
  });

  it('resolves the Inbox and Customers sections to their own surfaces', () => {
    const inbox = dashboardNavSections.find((s) => s.slug === 'inbox');
    const clients = dashboardNavSections.find((s) => s.slug === 'customers');
    if (!inbox || !clients) throw new Error('missing section');

    // Inbox (/dashboard/clients/inbox) and the unified Clients surface
    // (/dashboard/customers) no longer share a prefix, so each matches only its
    // own destination.
    expect(isDashboardSectionActive(inbox, BRANCH_PATHS.clientsInbox)).toBe(
      true
    );
    expect(isDashboardSectionActive(inbox, BRANCH_PATHS.customers)).toBe(false);
    expect(isDashboardSectionActive(clients, BRANCH_PATHS.customers)).toBe(
      true
    );
    expect(isDashboardSectionActive(clients, BRANCH_PATHS.clientsInbox)).toBe(
      false
    );
    expect(
      dashboardNavSections.find((s) =>
        isDashboardSectionActive(s, BRANCH_PATHS.clientsInbox)
      )?.slug
    ).toBe('inbox');
  });

  it('treats the organisation index as an exact match only', () => {
    const settings = dashboardNavSections.find((s) => s.slug === 'settings');
    const overview = settings?.items?.find((item) => item.title === 'Overview');
    if (!overview) throw new Error('missing overview item');

    expect(isDashboardNavItemActive(overview, ROUTES.organisation)).toBe(true);
    expect(isDashboardNavItemActive(overview, ROUTES.settingsPayments)).toBe(
      false
    );
  });
});

describe('filterNavForBookingDestination', () => {
  it('leaves navigation untouched for borradh organizations', () => {
    const out = filterNavForBookingDestination(dashboardNavSections, 'borradh');
    expect(out).toEqual(dashboardNavSections);
  });

  // Undefined while the org query is in flight. Hiding first and revealing
  // later would flash the whole sidebar on every load.
  it('leaves navigation untouched when the destination is unknown', () => {
    expect(
      filterNavForBookingDestination(dashboardNavSections, undefined)
    ).toEqual(dashboardNavSections);
    expect(filterNavForBookingDestination(dashboardNavSections, null)).toEqual(
      dashboardNavSections
    );
  });

  it('hides the booking-system sections for external_link organizations', () => {
    const slugs = filterNavForBookingDestination(
      dashboardNavSections,
      'external_link'
    ).map((s) => s.slug);

    expect(slugs).not.toContain('calendar');
    expect(slugs).not.toContain('booking-page');
    expect(slugs).not.toContain('sales');
    // Inventory is till-side in full, so the whole section goes rather than
    // being emptied item by item.
    expect(slugs).not.toContain('inventory');

    // The marketing/CRM surface is why these orgs are here at all.
    expect(slugs).toContain('inbox');
    expect(slugs).toContain('customers');
    expect(slugs).toContain('marketing');
    expect(slugs).toContain('settings');
  });

  // Claire quotes prices and durations from the service catalog, so hiding it
  // would break the chatbot for exactly the orgs this gating targets.
  it('keeps Services but hides the retail items under Catalog', () => {
    const catalog = filterNavForBookingDestination(
      dashboardNavSections,
      'external_link'
    ).find((s) => s.slug === 'catalog');

    const titles = catalog?.items?.map((i) => i.title) ?? [];
    expect(titles).toEqual(['Services']);
  });

  it('keeps Members but hides Shifts and Timesheets under Team', () => {
    const team = filterNavForBookingDestination(
      dashboardNavSections,
      'external_link'
    ).find((s) => s.slug === 'team');

    const titles = team?.items?.map((i) => i.title) ?? [];
    expect(titles).toContain('Members');
    expect(titles).not.toContain('Shifts');
    expect(titles).not.toContain('Timesheets');
  });

  it('hides blocked time types but keeps the rest of settings', () => {
    const settings = filterNavForBookingDestination(
      dashboardNavSections,
      'external_link'
    ).find((s) => s.slug === 'settings');

    const titles = settings?.items?.map((i) => i.title) ?? [];
    expect(titles).not.toContain('Blocked time types');
    expect(titles).not.toContain('Payments');
    // Bookings stays: it is where the org switches destination in the first
    // place, so hiding it would strand them on external_link.
    expect(titles).toContain('Bookings');
    expect(titles).toContain('Integrations');
    expect(titles).toContain('Overview');
  });

  it('does not mutate the shared nav definition', () => {
    const before = JSON.stringify(dashboardNavSections);
    filterNavForBookingDestination(dashboardNavSections, 'external_link');
    expect(JSON.stringify(dashboardNavSections)).toBe(before);
  });
});

describe('billing is not surfaced in navigation', () => {
  // Hidden for every organization, not conditionally: clinics do not
  // self-serve their Borradh subscription. The route still exists so support
  // can link directly to it.
  it('omits Billing from settings regardless of booking destination', () => {
    for (const destination of ['borradh', 'external_link', undefined]) {
      const settings = filterNavForBookingDestination(
        dashboardNavSections,
        destination
      ).find((s) => s.slug === 'settings');
      const titles = settings?.items?.map((i) => i.title) ?? [];
      expect(titles).not.toContain('Billing');
    }
  });
});

/**
 * Every nav TARGET must carry the branch once one is in scope.
 *
 * This is the regression that shipped: the sidebar rendered
 * `<Link to={section.url}>` straight from the un-prefixed `BRANCH_PATHS`
 * constants, so with a branch fully resolved it still emitted
 * `href="/dashboard/home"`. Nothing failed — the compatibility splat caught
 * every click and redirected — which is exactly why nothing noticed. When the
 * splat goes, those links 404.
 *
 * The nav config holding un-prefixed forms is CORRECT (one config serves every
 * branch, and the `match` arms compare against the un-prefixed pathname). What
 * has to hold is that resolution happens at render, and that is what these
 * assert.
 */
describe('nav targets resolve to the active branch', () => {
  const BRANCH = 'dublin';

  const allEntries = () => {
    const entries: {
      title: string;
      url: string;
      scope?: 'location' | 'org';
    }[] = [];
    for (const section of [
      ...dashboardNavSections,
      dashboardAssistantSection,
    ]) {
      entries.push({
        title: section.title,
        url: section.url,
        scope: section.scope,
      });
      for (const item of section.items ?? []) {
        entries.push({
          title: `${section.title} → ${item.title}`,
          url: item.url,
          scope: item.scope,
        });
      }
    }
    return entries;
  };

  it('prefixes every branch-scoped destination', () => {
    const branchValues = new Set<string>(Object.values(BRANCH_PATHS));
    const unresolved = allEntries()
      .filter((entry) => branchValues.has(entry.url))
      .filter(
        (entry) => !resolveNavUrl(entry, BRANCH).startsWith('/dashboard/l/')
      )
      .map((entry) => `${entry.title} → ${entry.url}`);

    expect(unresolved, unresolved.join('\n')).toEqual([]);
  });

  it('leaves org-level destinations alone', () => {
    const orgValues = new Set<string>(
      Object.values(ROUTES).filter((v): v is string => typeof v === 'string')
    );
    const wronglyPrefixed = allEntries()
      .filter((entry) => orgValues.has(entry.url))
      .filter((entry) => resolveNavUrl(entry, BRANCH) !== entry.url)
      .map((entry) => `${entry.title} → ${entry.url}`);

    expect(wronglyPrefixed, wronglyPrefixed.join('\n')).toEqual([]);
  });

  it('falls back to the un-prefixed path when the org has no branch', () => {
    // An org mid-onboarding genuinely has nowhere to point. The un-prefixed
    // path is the honest answer; `/dashboard/l/null/...` would be a 404.
    for (const entry of allEntries()) {
      expect(resolveNavUrl(entry, null)).toBe(entry.url);
    }
  });

  it('keeps BRANCH_PATHS and ROUTES disjoint', () => {
    // `resolveNavUrl` decides scope by BRANCH_PATHS membership, so an overlap
    // would silently make an org-level destination branch-scoped.
    const branchValues = new Set<string>(Object.values(BRANCH_PATHS));
    const collisions = Object.values(ROUTES)
      .filter((v): v is string => typeof v === 'string')
      .filter((v) => branchValues.has(v));

    expect(collisions).toEqual([]);
  });
});
