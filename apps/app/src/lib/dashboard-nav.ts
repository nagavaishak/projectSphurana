import {
  branchPath,
  stripBranchFromPath,
} from '@/features/organization-locations/branch-path';
import { BRANCH_PATHS, ROUTES, isBranchScopedPath } from '@/lib/route-paths';
import {
  Bot,
  Boxes,
  CalendarDays,
  ChartColumn,
  Globe,
  Inbox,
  type LucideIcon,
  Megaphone,
  PackageSearch,
  Receipt,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  UsersRound,
} from 'lucide-react';

export interface DashboardNavItem {
  title: string;
  /**
   * The destination. For a `scope: 'location'` entry this is the UN-PREFIXED
   * path (`/dashboard/calendar/day`) — the branch is added at render by
   * `resolveNavUrl`, because one nav config serves every branch and cannot
   * know which one is active.
   */
  url: string;
  /**
   * `'location'` = lives under `/dashboard/l/:locationId/`. Defaults to
   * `'org'`, so an entry that has not been migrated yet keeps working
   * unchanged — which is what lets slices move one at a time.
   */
  scope?: 'location' | 'org';
  /** Match the pathname exactly instead of by prefix (e.g. settings index). */
  exact?: boolean;
  /** Renders acceptably on a phone. `false` = flagged as desktop-first. */
  mobileReady?: boolean;
  /**
   * Optional sub-heading the item sits under in the secondary panel (e.g.
   * Settings splits into "Personal" and "Organisation"). Items sharing a group
   * are rendered together under one label, in declaration order.
   */
  group?: string;
}

export interface DashboardNavSection {
  title: string;
  /** Stable slug for `/dashboard/more/$section`. */
  slug: string;
  icon: LucideIcon;
  /** Where the section navigates on click (rail item / More card). Same
   *  un-prefixed convention as `DashboardNavItem.url` when branch-scoped. */
  url: string;
  /** See `DashboardNavItem.scope`. */
  scope?: 'location' | 'org';
  /** Pathname prefixes that mark this section active. */
  match: string[];
  /** Sub-navigation; empty = the section navigates straight to `url`. */
  items?: DashboardNavItem[];
  /**
   * Optional heading the section sits under in the sidebar (e.g. the
   * "Location" block). Sections sharing a group render together under one
   * `SidebarGroupLabel`, in declaration order. Undefined = the leading,
   * unlabelled group.
   */
  group?: string;
}

/**
 * Heading for the sections scoped to the branch you are working in — its
 * diary, its takings, what it sells and stocks, who staffs it and how it is
 * set up. Named "Location" (not the old "Management") because the grouping is
 * about WHOSE data these are, which is what the location-focused product is
 * organised around.
 *
 * The constant name stays `MANAGEMENT_GROUP` to avoid churning its call sites;
 * only the rendered label changed.
 */
export const MANAGEMENT_GROUP = 'Location';

/**
 * Single source of truth for dashboard navigation. Consumed by the desktop
 * two-tier sidebar and by the mobile More tab, so the two cannot drift.
 */
export const dashboardNavSections: DashboardNavSection[] = [
  {
    // Renamed Home → "Ask AI": the surface IS the Claire prompt, and calling it
    // Home said nothing about what it does. Slug stays `home` — it is a mobile
    // bottom tab (TAB_OWNED_SLUGS) and a `/dashboard/more/:slug` URL.
    title: 'Ask AI',
    slug: 'home',
    icon: Sparkles,
    url: BRANCH_PATHS.home,
    scope: 'location',
    match: [BRANCH_PATHS.home, '/dashboard/account'],
  },
  {
    title: 'AI Assistant',
    slug: 'ai-assistant',
    icon: Bot,
    url: BRANCH_PATHS.aiAssistant,
    scope: 'location',
    match: [BRANCH_PATHS.aiAssistant],
  },
  {
    // Listed before Customers so its more-specific prefix wins the active match.
    title: 'Inbox',
    slug: 'inbox',
    icon: Inbox,
    url: BRANCH_PATHS.clientsInbox,
    scope: 'location',
    match: [BRANCH_PATHS.clientsInbox],
  },
  {
    // Unified Customers surface (unify-customers): the whole customer base —
    // leads and booked clients — in one place. Replaces the old separate
    // "Leads" (/clients/list) and "Clients" (/patients) surfaces.
    title: 'Customers',
    slug: 'customers',
    icon: Users,
    url: BRANCH_PATHS.customers,
    scope: 'location',
    match: [BRANCH_PATHS.customers],
  },
  {
    title: 'Marketing',
    slug: 'marketing',
    icon: Megaphone,
    url: BRANCH_PATHS.socials,
    match: [BRANCH_PATHS.marketing],
    items: [
      { title: 'Socials', url: BRANCH_PATHS.socials },
      { title: 'Advertising', url: BRANCH_PATHS.advertising },
      { title: 'Bulk Messaging', url: BRANCH_PATHS.campaigns },
      { title: 'Lead forms', url: BRANCH_PATHS.marketingLeadForms },
      { title: 'Gallery', url: BRANCH_PATHS.contentGallery },
      { title: 'Sequences', url: BRANCH_PATHS.marketingSequences },
    ],
  },
  {
    title: 'Calendar',
    slug: 'calendar',
    icon: CalendarDays,
    // Link straight to the day view: going through ROUTES.calendar bounces off
    // the index route's beforeLoad redirect, and the transient mount/teardown
    // can leave AppointmentsProvider's queries wedged on loading skeletons.
    url: BRANCH_PATHS.calendarDay,
    scope: 'location',
    match: [BRANCH_PATHS.calendar],
    group: MANAGEMENT_GROUP,
  },
  {
    // The branch's customer-facing venue / online booking page — its public
    // shopfront, so it belongs to the location rather than the leading block.
    title: 'Booking page',
    slug: 'booking-page',
    icon: Globe,
    url: BRANCH_PATHS.venue,
    scope: 'location',
    match: [BRANCH_PATHS.venue],
    group: MANAGEMENT_GROUP,
  },
  {
    title: 'Sales',
    slug: 'sales',
    icon: Receipt,
    url: BRANCH_PATHS.salesDailySummary,
    match: [BRANCH_PATHS.sales],
    items: [
      { title: 'Daily summary', url: BRANCH_PATHS.salesDailySummary },
      { title: 'Appointments', url: BRANCH_PATHS.salesAppointments },
      { title: 'Sales list', url: BRANCH_PATHS.salesList },
      { title: 'Payments', url: BRANCH_PATHS.salesPayments },
      // "… sales", not the bare noun: Catalog owns the membership PLANS and
      // the gift cards you SELL; these are the records of ones customers
      // BOUGHT. The bare labels collided with the Catalog tabs.
      { title: 'Gift card sales', url: BRANCH_PATHS.salesGiftCards },
      { title: 'Membership sales', url: BRANCH_PATHS.salesMemberships },
      { title: 'Product orders', url: BRANCH_PATHS.salesProductOrders },
    ],
    group: MANAGEMENT_GROUP,
  },
  {
    // Catalog is what the clinic SELLS. Stock movement and the product taxonomy
    // that only stock uses moved out to Inventory below — Catalog had grown to
    // ten items spanning two unrelated jobs.
    title: 'Catalog',
    slug: 'catalog',
    icon: Boxes,
    url: BRANCH_PATHS.services,
    match: [BRANCH_PATHS.catalog],
    items: [
      { title: 'Services', url: BRANCH_PATHS.services },
      { title: 'Memberships', url: BRANCH_PATHS.catalogMemberships },
      { title: 'Products', url: BRANCH_PATHS.catalogProducts },
      // Labelled "Promotions" — the component has been `promotions-page.tsx`
      // for a while; only the nav still said "Offers". Route slug unchanged.
      { title: 'Promotions', url: BRANCH_PATHS.offers },
      { title: 'Rooms & equipment', url: BRANCH_PATHS.catalogResources },
    ],
    group: MANAGEMENT_GROUP,
  },
  {
    // Inventory is how stock MOVES: who you buy from, what you counted, what
    // you ordered.
    title: 'Inventory',
    slug: 'inventory',
    icon: PackageSearch,
    url: BRANCH_PATHS.inventorySuppliers,
    match: [BRANCH_PATHS.inventory],
    items: [
      { title: 'Suppliers', url: BRANCH_PATHS.inventorySuppliers },
      { title: 'Stocktakes', url: BRANCH_PATHS.inventoryStocktakes },
      { title: 'Stock Orders', url: BRANCH_PATHS.inventoryStockOrders },
      // Brands and Categories are deliberately NOT tabs: they are product
      // taxonomy the product form picks from, not surfaces you visit. Their
      // routes still exist and still mark this section active (the
      // BRANCH_PATHS.inventory prefix covers them), so they stay reachable by
      // URL until the Products page grows a "manage brands / categories"
      // affordance (location-focused-redesign.md §7).
    ],
    group: MANAGEMENT_GROUP,
  },
  {
    title: 'Team',
    slug: 'team',
    icon: UsersRound,
    url: BRANCH_PATHS.teamMembers,
    match: ['/dashboard/team'],
    items: [
      { title: 'Members', url: BRANCH_PATHS.teamMembers },
      { title: 'Shifts', url: BRANCH_PATHS.teamShifts },
      { title: 'Timesheets', url: BRANCH_PATHS.teamTimesheets },
    ],
    group: MANAGEMENT_GROUP,
  },
  // Org-wide analytics. Not branch-scoped — an owner asks these questions
  // about the business, not about one site — so they sit outside the location
  // switcher rather than under a branch path.
  {
    title: 'Retention',
    slug: 'retention',
    icon: TrendingUp,
    url: ROUTES.retention,
    match: [ROUTES.retention],
    group: MANAGEMENT_GROUP,
  },
  {
    title: 'Reviews',
    slug: 'reviews',
    icon: Star,
    url: ROUTES.reviews,
    match: [ROUTES.reviews],
    group: MANAGEMENT_GROUP,
  },
  {
    title: 'Reports',
    slug: 'reports',
    icon: ChartColumn,
    url: ROUTES.reports,
    match: [ROUTES.reports],
    group: MANAGEMENT_GROUP,
  },
  {
    title: 'Organisation settings',
    slug: 'settings',
    icon: Settings,
    // Lands on the org-settings HUB, not `/dashboard/settings` — that path is
    // the PERSONAL profile page, so pointing here at it made a row labelled
    // "Organisation settings" open your own account. Personal settings are
    // reached from the user menu at the foot of the sidebar instead.
    url: ROUTES.organisation,
    // Locations and Intake forms sit at top-level /dashboard paths rather than
    // under /dashboard/settings, so their prefixes are listed explicitly to
    // mark the section active on them. (Intake forms used to hang off Catalog
    // for the same reason.)
    match: [
      ROUTES.organisation,
      '/dashboard/settings',
      ROUTES.locations,
      ROUTES.intakeForms,
    ],
    items: [
      {
        title: 'Overview',
        url: ROUTES.organisation,
        exact: true,
        group: 'Organisation',
      },
      // Locations is the spine of the location-focused product, so it leads the
      // Organisation group rather than sitting in a settings-dialog tab.
      {
        title: 'Locations',
        url: ROUTES.locations,
        group: 'Organisation',
      },
      // Moved out of Catalog: an intake form is clinic setup (it attaches to
      // services and is collected before an appointment), not a thing you sell.
      {
        title: 'Intake forms',
        url: ROUTES.intakeForms,
        group: 'Organisation',
      },
      {
        title: 'Claire WhatsApp',
        url: ROUTES.settingsClaireWhatsapp,
        group: 'Organisation',
      },
      { title: 'Details', url: ROUTES.settingsDetails, group: 'Organisation' },
      // Sits beside Consent forms: that page is what the forms SAY, this one is
      // who has signed them, plus the export and erasure duties that follow.
      {
        title: 'Consent & privacy',
        url: ROUTES.settingsConsentPrivacy,
        group: 'Organisation',
      },
      {
        title: 'Reminders & rebooking',
        url: ROUTES.settingsReminders,
        group: 'Organisation',
      },
      {
        title: 'Bookings',
        url: ROUTES.settingsBookings,
        group: 'Organisation',
      },
      // Sits directly under Bookings — consent forms are part of the booking
      // setup (they attach to services and are collected before appointments).
      {
        title: 'Consent Forms',
        url: ROUTES.settingsConsentForms,
        group: 'Organisation',
      },
      // The unified builder: intake, consent and clinical note templates on one
      // page. Sits beside the two single-kind pages it will eventually replace.
      {
        title: 'Form templates',
        url: ROUTES.settingsFormTemplates,
        group: 'Organisation',
      },
      // Scheduling settings are a "Coming soon" placeholder — hidden until built.
      {
        title: 'Blocked time types',
        url: ROUTES.settingsBlockedTimeTypes,
        group: 'Organisation',
      },
      { title: 'Brand style', url: ROUTES.brand, group: 'Organisation' },
      {
        title: 'Integrations',
        url: ROUTES.integrations,
        group: 'Organisation',
      },
      {
        title: 'Message templates',
        url: ROUTES.settingsMessageTemplates,
        group: 'Organisation',
      },
      {
        title: 'Payments',
        url: ROUTES.settingsPayments,
        group: 'Organisation',
      },
      // Billing (the org's own Borradh subscription) is deliberately not
      // surfaced in navigation. The route still exists, so support can link
      // someone straight to it; it is simply not something clinics self-serve.
    ],
  },
];

/**
 * The full-screen Claire product surface (`/assistant`), behind the
 * `claire-assistant-sidebar` flag. Titled "Claire", not "AI Assistant": the
 * in-dashboard section at `/dashboard/ai-assistant` is now called "Assistant",
 * and two rail items reading "Assistant" / "AI Assistant" is a coin toss.
 */
export const dashboardAssistantSection: DashboardNavSection = {
  title: 'Claire',
  slug: 'assistant',
  icon: Sparkles,
  url: ROUTES.assistant,
  match: ['/assistant'],
};

/**
 * Resolve a nav entry's href for the branch currently in scope.
 *
 * `locationId` may be null (an org-level page, or an org with no branches yet);
 * the un-prefixed path is then returned as-is and the compatibility splat
 * redirects it. That fallback is what keeps the nav usable on
 * `/dashboard/settings`, where there is no branch in the URL to read.
 */
export function resolveNavUrl(
  entry: Pick<DashboardNavItem, 'url' | 'scope'>,
  locationId: string | null
): string {
  // Scope is DERIVED from the url, not read off the `scope` tag.
  //
  // The tag has to be maintained by hand and was not: only 7 of the ~46
  // branch-scoped destinations in this file carried `scope: 'location'`, and
  // the child items carried none at all. Deriving it from `BRANCH_PATHS`
  // membership makes the config's `url` the single source of truth, so a new
  // entry cannot be added in the un-prefixed-by-accident state. `scope: 'org'`
  // stays available as an explicit opt-OUT.
  if (entry.scope === 'org') return entry.url;
  if (!locationId || !isBranchScopedPath(entry.url)) return entry.url;
  return branchPath(locationId, entry.url.replace(/^\/dashboard/, ''));
}

/**
 * Active-state matching runs on the UN-PREFIXED pathname.
 *
 * `match` prefixes are written as `/dashboard/calendar`, and a real pathname is
 * `/dashboard/l/loc-1/calendar`. Normalising the pathname once here — rather
 * than teaching every `match` entry about a variable id — keeps the URL shape
 * in `branch-path.ts` and leaves this config readable.
 */
export function isDashboardSectionActive(
  section: DashboardNavSection,
  pathname: string
): boolean {
  const normalised = stripBranchFromPath(pathname);
  return section.match.some(
    (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`)
  );
}

export function isDashboardNavItemActive(
  item: DashboardNavItem,
  pathname: string
): boolean {
  const normalised = stripBranchFromPath(pathname);
  if (item.exact) {
    return normalised === item.url || normalised === `${item.url}/`;
  }
  return normalised === item.url || normalised.startsWith(`${item.url}/`);
}

/**
 * Groups a section's items by their optional `group` label, preserving
 * declaration order. Items without a `group` fall under `label: undefined`,
 * which the panel renders without a sub-heading. Sections whose items define no
 * groups collapse to a single `{ label: undefined }` entry.
 */
export function groupDashboardNavItems(
  items: DashboardNavItem[]
): { label: string | undefined; items: DashboardNavItem[] }[] {
  const groups: { label: string | undefined; items: DashboardNavItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.label === item.group) {
      last.items.push(item);
    } else {
      groups.push({ label: item.group, items: [item] });
    }
  }
  return groups;
}

export function findDashboardNavSection(
  slug: string
): DashboardNavSection | undefined {
  return dashboardNavSections.find((section) => section.slug === slug);
}

// =============================================================================
// BOOKING-DESTINATION GATING
// =============================================================================

/**
 * Sections that only make sense when bookings live in Borradh.
 *
 * A clinic whose diary is in Fresha or Cliniko has no appointments here to
 * show, nothing to check out at the till, and no stock moving through it — so
 * these read as broken rather than empty.
 */
const BORRADH_ONLY_SECTION_SLUGS = new Set([
  'calendar',
  'booking-page',
  'sales',
  // Inventory in full: suppliers, counts and orders are all till-side. Catalog
  // survives (minus its retail items) only because Claire reads Services.
  'inventory',
]);

/**
 * Sub-items hidden for the same reason, keyed by section slug.
 *
 * Catalog keeps ONLY Services: Claire quotes prices and durations from it, so
 * hiding it would break the chatbot for exactly the organizations this gating
 * targets. Everything else under Catalog is retail/inventory, which requires
 * the till.
 *
 * Team keeps Members. Shifts exist solely to drive OUR availability, and
 * Timesheets clock against our appointments.
 */
const BORRADH_ONLY_ITEM_TITLES: Record<string, Set<string>> = {
  // Stock/supply items moved to the Inventory section, which is hidden whole
  // (see BORRADH_ONLY_SECTION_SLUGS) — so only the retail items Catalog kept
  // are listed here. Services stays for Claire. "Rooms & equipment" is here
  // because a clinic whose diary lives in Fresha has nothing to allocate a
  // room TO — the page would render an empty scheduler, not a useful one.
  catalog: new Set([
    'Memberships',
    'Products',
    'Promotions',
    'Rooms & equipment',
  ]),
  team: new Set(['Shifts', 'Timesheets']),
  // Payments is Stripe Connect for deposits/checkout — booking machinery, so
  // it only applies when bookings live here. (Billing is hidden for everyone,
  // in the section definition above, not conditionally.)
  // 'Intake forms' moved here from Catalog and stays hidden for the same
  // reason it was hidden there: a form collected before an appointment is
  // booking machinery. 'Locations' deliberately stays VISIBLE — an org that
  // books elsewhere still has branches, and still markets them.
  settings: new Set(['Blocked time types', 'Payments', 'Intake forms']),
};

/**
 * Hide the booking-system surface for organizations that book elsewhere.
 *
 * Driven by `booking_destination` alone (ENG-500), so flipping the setting in
 * Settings → Bookings immediately produces the right navigation with no
 * separate flag to keep in step.
 *
 * Returns the sections unchanged for `borradh`, and — deliberately — also when
 * the destination is not yet known (undefined while the org query is in
 * flight). Hiding first and revealing later would make the whole sidebar flash
 * on every load, which is worse than briefly showing a section the user can
 * already reach by URL.
 */
export function filterNavForBookingDestination(
  sections: DashboardNavSection[],
  bookingDestination: string | null | undefined
): DashboardNavSection[] {
  if (bookingDestination !== 'external_link') return sections;

  return sections
    .filter((section) => !BORRADH_ONLY_SECTION_SLUGS.has(section.slug))
    .map((section) => {
      const hidden = BORRADH_ONLY_ITEM_TITLES[section.slug];
      if (!hidden || !section.items) return section;
      return {
        ...section,
        items: section.items.filter((item) => !hidden.has(item.title)),
      };
    });
}
