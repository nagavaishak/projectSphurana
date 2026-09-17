import type { OnboardingTask } from '@borradh-workspace/api-client/types';

import { branchPath } from '@/features/organization-locations/branch-path';

/**
 * ORG-LEVEL pathnames — the dashboard URL tree that is NOT scoped to a branch.
 * Use these in <Link>, navigate(), redirect(), and href.
 *
 * Branch-scoped destinations do NOT live here. They are built per-branch by
 * `branchRoutes(locationId)` below, and reached through the `useRoutes()` hook.
 * Keys migrate from this object into that factory one slice at a time as their
 * route files move under `/dashboard/l/:locationId/` — which is why both exist
 * during the transition rather than one replacing the other in a single step.
 */
export const ROUTES = {
  dashboard: '/dashboard',
  /** Mobile personal area (avatar tap); shows bottom tab bar. */
  dashboardAccount: '/dashboard/account',
  /** Mobile "More" tab: every dashboard destination not in the bottom tabs. */
  more: '/dashboard/more',
  assistant: '/assistant',
  adsNew: '/ads/new',
  adsNewVideoFormat: '/ads/new/video-format',
  gettingStarted: '/dashboard/getting-started',
  /**
   * Branch management. Org-level on purpose — you come here to add or switch a
   * location, so it must not itself sit behind a selected location.
   */
  locations: '/dashboard/locations',
  /** Adding a branch renders from the shared create/edit editor. */
  locationsNew: '/create/location',
  intakeForms: '/dashboard/intake-forms',
  /** The notifications FEED. `settingsNotifications` is the preferences form. */
  notifications: '/dashboard/notifications',
  /** The org-settings HUB, not `/dashboard/settings` — that is the PERSONAL profile page. */
  organisation: '/dashboard/organisation',
  /** Org-wide analytics — not branch-scoped, so they sit outside BRANCH_PATHS. */
  reports: '/dashboard/reports',
  retention: '/dashboard/retention',
  reviews: '/dashboard/reviews',
  settings: '/dashboard/settings',
  settingsDetails: '/dashboard/settings/details',
  settingsBookings: '/dashboard/settings/bookings',
  settingsConsentForms: '/dashboard/settings/consent-forms',
  /**
   * The unified template library — intake, consent and clinical note templates
   * are one thing (docs/handoffs/portal.md §2.8), so they are one page.
   */
  settingsFormTemplates: '/dashboard/settings/form-templates',
  /**
   * Consent COMPLIANCE, distinct from `settingsConsentForms` above, which is the
   * template library. This is the operational side: who owes a renewal, the
   * chrome-free kiosk a patient signs on, and the export/erase obligations that
   * ride on the same consent record.
   */
  settingsConsentPrivacy: '/dashboard/settings/consent-privacy',
  settingsClaireWhatsapp: '/dashboard/settings/claire-whatsapp',
  settingsBilling: '/dashboard/settings/billing',
  settingsNotifications: '/dashboard/settings/notifications',
  settingsReminders: '/dashboard/settings/reminders',
  settingsBlockedTimeTypes: '/dashboard/settings/blocked-time-types',
  settingsPayments: '/dashboard/settings/payments',
  settingsMessageTemplates: '/dashboard/settings/message-templates',
  brand: '/dashboard/settings/style',
  integrations: '/dashboard/settings/integrations',
  servicesNew: '/create/service',
} as const;

/**
 * BRANCH-SCOPED destinations, held UN-PREFIXED.
 *
 * These are the `/dashboard/...` forms; `branchRoutes(locationId)` below strips
 * the `/dashboard` and re-roots each one under `/dashboard/l/:locationId/`.
 * They stay listed here (rather than inline in the factory) so the two shapes
 * of the same destination cannot drift.
 */
export const BRANCH_PATHS = {
  home: '/dashboard/home',
  calendar: '/dashboard/calendar',
  calendarDay: '/dashboard/calendar/day',
  calendarWeek: '/dashboard/calendar/week',
  calendarMonth: '/dashboard/calendar/month',
  calendarYear: '/dashboard/calendar/year',
  calendarAgenda: '/dashboard/calendar/agenda',
  calendarThreeDay: '/dashboard/calendar/three-day',
  /** Rooms axis of the calendar — one column per room instead of per staff. */
  calendarRooms: '/dashboard/calendar/rooms',
  /** The rooms axis defaults to the day view, like the bookings axis. */
  calendarRoomsDay: '/dashboard/calendar/rooms/day',
  calendarNew: '/dashboard/calendar/new',
  calendarNewBlock: '/dashboard/calendar/new/block',
  calendarNewClient: '/dashboard/calendar/new/client',
  aiAssistant: '/dashboard/ai-assistant',
  clientsInbox: '/dashboard/clients/inbox',
  conversations: '/dashboard/clients/inbox',
  customers: '/dashboard/customers',
  deposits: '/dashboard/deposits',
  venue: '/dashboard/venue',
  teamMembers: '/dashboard/team/members',
  teamShifts: '/dashboard/team/shifts',
  teamTimesheets: '/dashboard/team/timesheets',
  content: '/dashboard/marketing/gallery',
  contentVideos: '/dashboard/marketing/gallery/videos',
  contentImages: '/dashboard/marketing/gallery/images',
  contentGallery: '/dashboard/marketing/gallery',
  contentCalendar: '/dashboard/marketing/socials',
  contentCalendarMonth: '/dashboard/marketing/socials',
  videos: '/dashboard/marketing/gallery',
  videosCreateFromClient: '/dashboard/videos/create-from-client',
  marketing: '/dashboard/marketing',
  marketingLeadForms: '/dashboard/marketing/lead-forms',
  advertising: '/dashboard/marketing/advertising',
  advertisingNew: '/dashboard/marketing/advertising/new',
  campaigns: '/dashboard/marketing/campaigns',
  socials: '/dashboard/marketing/socials',
  // Wireframes mounted at their real homes so the IA can be judged in place.
  marketingSequences: '/dashboard/marketing/sequences',
  catalog: '/dashboard/catalog',
  services: '/dashboard/catalog/services',
  catalogMemberships: '/dashboard/catalog/memberships',
  catalogProducts: '/dashboard/catalog/products',
  /** Rooms & equipment — the clinic's bookable non-human resources. */
  catalogResources: '/dashboard/catalog/resources',
  offers: '/dashboard/catalog/offers',
  inventory: '/dashboard/inventory',
  inventorySuppliers: '/dashboard/inventory/suppliers',
  inventoryStocktakes: '/dashboard/inventory/stocktakes',
  inventoryStockOrders: '/dashboard/inventory/stock-orders',
  sales: '/dashboard/sales',
  salesDailySummary: '/dashboard/sales/daily-summary',
  salesAppointments: '/dashboard/sales/appointments',
  salesList: '/dashboard/sales/list',
  salesPayments: '/dashboard/sales/payments',
  salesGiftCards: '/dashboard/sales/gift-cards',
  salesMemberships: '/dashboard/sales/memberships',
  salesProductOrders: '/dashboard/sales/product-orders',
} as const;

export const branchRoutes = (locationId: string) => ({
  ...(Object.fromEntries(
    Object.entries(BRANCH_PATHS).map(([key, path]) => [
      key,
      branchPath(locationId, path.replace(/^\/dashboard/, '')),
    ])
  ) as Record<keyof typeof BRANCH_PATHS, string>),

  // Parameterised destinations. Functions rather than templates because the
  // caller has the id and nothing else should be assembling these by hand —
  // a stray `${routes.customers}/${id}` elsewhere is how the prefix gets
  // forgotten on one path and not another.
  customerDetail: (leadId: string) =>
    branchPath(locationId, `/customers/${leadId}`),
  campaignsNew: branchPath(locationId, '/marketing/campaigns/new'),
  campaignDetail: (id: string) =>
    branchPath(locationId, `/marketing/campaigns/${id}`),
  advertisingCampaign: (id: string) =>
    branchPath(locationId, `/marketing/advertising/${id}`),
  advertisingAd: (campaignId: string, adId: string) =>
    branchPath(locationId, `/marketing/advertising/${campaignId}/ads/${adId}`),
  socialPost: (id: string) =>
    branchPath(locationId, `/marketing/socials/post/${id}`),
});

export type BranchRoutes = ReturnType<typeof branchRoutes>;

/** Next `getting-started/page.tsx` uses `/dashboard/getting-started/<taskId>` (no dedicated pages in web). */
export function gettingStartedTaskPath(taskId: OnboardingTask): string {
  return `/dashboard/getting-started/${taskId}`;
}

/**
 * Is this un-prefixed path a BRANCH-scoped destination?
 *
 * Derived from `BRANCH_PATHS` itself rather than declared per nav entry. A
 * separate `scope: 'location'` tag has to be kept in sync by hand, and it was
 * not: only 7 of the ~46 branch destinations in the nav config carried one, so
 * the sidebar emitted un-prefixed hrefs for the rest and every click went
 * through the compatibility splat's redirect. The `url` already encodes the
 * truth; asking it directly is what removes the drift.
 *
 * `BRANCH_PATHS` and `ROUTES` are disjoint (there is a test), so membership is
 * unambiguous. Sub-paths count too — `/dashboard/calendar/week/2026-01-01`
 * belongs to the branch that `/dashboard/calendar` does.
 */
const BRANCH_PATH_VALUES: ReadonlySet<string> = new Set(
  Object.values(BRANCH_PATHS)
);

export function isBranchScopedPath(url: string): boolean {
  if (BRANCH_PATH_VALUES.has(url)) return true;
  for (const branchPath of BRANCH_PATH_VALUES) {
    if (url.startsWith(`${branchPath}/`)) return true;
  }
  return false;
}

export function serviceEditPath(serviceId: string): string {
  return `/edit/service/${serviceId}`;
}

export function advertisingAdDetailPath(
  campaignId: string,
  adId: string
): string {
  return `/dashboard/marketing/advertising/${campaignId}/ads/${adId}`;
}

// REMOVED: productEditPath / stockOrderPath / stockTakePath.
//
// All three had zero callers repo-wide AND pointed at detail routes that do not
// exist (`/catalog/products/:id`, `/catalog/stock-orders/:id`,
// `/catalog/stocktakes/:id` — there are no `$id` route files). They promised a
// detail-page shape the app has never had; products, stock orders and stock
// takes are all edited in dialogs today. When the unified editors land
// (location-focused-redesign.md §7) the real routes get added here, under
// /dashboard/inventory, alongside the pages that serve them.
