import type { QueryClient } from '@tanstack/react-query';

/**
 * The one place a query key may be spelled.
 *
 * WHY THIS EXISTS. TanStack matches query keys by PREFIX, so invalidating a key
 * that no query ever defines is a **silent no-op**: nothing throws, nothing
 * logs, the mutation's `onSuccess` looks like it worked, and the cache keeps
 * serving stale data until `staleTime` elapses. We shipped **ten** of them. The
 * worst was `invalidateQueries({ queryKey: ['session'] })` in
 * `set-active-organization` — the real key is `['auth', 'session']`, so
 * switching organisation did **not** refresh the session and the app went on
 * serving the PREVIOUS tenant's `activeOrganizationId` as fresh.
 *
 * The tenth was found BY the gate, not by the audit: `['calendar-accounts']`,
 * hidden inside a helper that returned `string[][]`, so it never appeared at a
 * `queryKey:` site at all. That is the argument for deriving the gate's input.
 *
 * A key produced here is produced in exactly one place, so a hook cannot invent
 * a root that no query answers to.
 *
 * TYPE ENFORCEMENT, HONESTLY DESCRIBED. Keys are branded, and `invalidateKeys`
 * below accepts only branded keys — inside migrated code a raw `string[]` is a
 * compile error. It is NOT possible to narrow TanStack's own
 * `invalidateQueries({ queryKey })` signature (its `QueryKey` is
 * `readonly unknown[]`, and module augmentation can only widen), so the
 * repo-wide enforcement is the derived gate in `query-keys.test.ts`:
 *   - every invalidated root must be a root some query actually defines, and
 *   - the number of raw array-literal query keys may only go DOWN (a ratchet).
 *
 * @see query-keys.test.ts
 * @see docs/engineering/derived-gates-and-operation-spine.md (W4)
 */

/**
 * Phantom brand — no runtime existence. A `unique symbol` would be tidier but
 * TS cannot *name* one when it infers a type across a module boundary
 * (TS4023 on `sessionQueryOptions`), so this is a plain nominal property.
 */
export interface QueryKeyBrand {
  readonly __appQueryKey: 'produced-by-the-queryKeys-factory';
}

/**
 * A query key that came out of the `queryKeys` factory. At runtime this is a
 * plain readonly array; the brand exists so a hand-rolled `['auth', 'session']`
 * is unassignable wherever a key is expected.
 */
export type AppQueryKey<T extends readonly unknown[] = readonly unknown[]> = T &
  QueryKeyBrand;

const key = <const T extends readonly unknown[]>(...parts: T): AppQueryKey<T> =>
  parts as unknown as AppQueryKey<T>;

/**
 * Roots mirror the API resource they cache, and every key is a prefix-extension
 * of its own `all()`, so invalidating `all()` reaches every key beneath it.
 * That prefix discipline is the whole point: it is what makes
 * `queryKeys.organization.all()` a correct blunt instrument instead of a guess.
 */
export const queryKeys = {
  auth: {
    all: () => key('auth'),
    /** `GET auth/session` — see `sessionQueryOptions` in `lib/session.ts`. */
    session: () => key('auth', 'session'),
  },

  appVersion: {
    all: () => key('app-version'),
    /** `GET app-version/check` — see `useCheckAppVersion`. */
    check: () => key('app-version', 'check'),
  },

  organization: {
    all: () => key('organization'),
    list: () => key('organization', 'list'),
    active: () => key('organization', 'active'),
    detail: (organizationId: string) => key('organization', organizationId),
    members: (organizationId: string) =>
      key('organization', organizationId, 'members'),
    brand: (organizationId: string) =>
      key('organization', organizationId, 'brand'),
  },

  user: {
    all: () => key('user'),
    detail: (userId: string) => key('user', userId),
  },

  /**
   * The org's service catalog. The list query defines this root
   * (`['organization-services', 'list', …]`); `variants` nests a service's
   * pricing options UNDER the same root so invalidating `all()` refreshes both
   * the service list (whose displayed "from" price is derived from its variants)
   * and any open variants query.
   */
  /**
   * Root matches the API resource, and `catalog` extends it, so invalidating
   * `all()` reaches a branch's catalogue too. The existing list key
   * (`'organization-locations', 'list', orgId`) is the same prefix.
   */
  organizationLocations: {
    all: () => key('organization-locations'),
    list: (organizationId: string) =>
      key('organization-locations', 'list', organizationId),
    catalog: (locationId: string) =>
      key('organization-locations', locationId, 'catalog'),
  },

  organizationServices: {
    all: () => key('organization-services'),
    detail: (serviceId: string) => key('organization-services', serviceId),
    variants: (serviceId: string) =>
      key('organization-services', serviceId, 'variants'),
  },

  /**
   * The org's user-defined service categories — a separate root from
   * `organizationServices`, because the chips are their own list query
   * (`['service-categories', 'list']`) and a catalogue write does not
   * generally change them. The spreadsheet import is the exception: it can
   * CREATE categories, so it invalidates both roots.
   */
  serviceCategories: {
    all: () => key('service-categories'),
  },

  /** A location's standing weekly opening hours + date overrides. */
  locationOpeningHours: {
    all: () => key('location-opening-hours'),
  },

  /**
   * The retail catalogue, the plan catalogue and the promotion catalogue.
   *
   * Each carries `all` plus a `detail`, which is what the branch-assignment
   * writes ("import from another location") invalidate: the list changes
   * because a record became available here, and the record itself changes
   * because its branch set did.
   */
  products: {
    all: () => key('products'),
    detail: (productId: string) => key('products', productId),
  },

  membershipPlans: {
    all: () => key('membership-plans'),
    detail: (planId: string) => key('membership-plans', planId),
  },

  offers: {
    all: () => key('offers'),
    detail: (offerId: string) => key('offers', offerId),
  },

  /**
   * The booking calendar. Only `all()` is spelled here so far — the existing
   * appointment hooks still use raw keys (grandfathered in the ratchet) and
   * define both `['appointments', id]` and `['appointments', 'list', …]`, so
   * `all()` is the prefix over every one of them. Reassigning a resource
   * invalidates it, because an appointment's own resource summary changes too.
   */
  appointments: {
    all: () => key('appointments'),
  },

  /**
   * Rooms & equipment (resource scheduling).
   *
   * One root over five distinct queries — categories, the resource list, a
   * service's requirements, the calendar's allocations and the utilisation
   * report — so `all()` is the prefix every resource mutation invalidates.
   * That is what makes create/update/delete refresh the settings list AND the
   * calendar blocks in one call, which matters because a room's colour or
   * capacity is rendered by both.
   *
   * PREFIX VS EXACT, SPELLED SEPARATELY. `list`, `allocations` and
   * `utilisation` are keyed BY their params — the window the calendar is
   * showing, the filters the settings page has applied — so a caller that
   * wants every variant needs a strictly shorter key than a caller that wants
   * one. The optimistic hooks depend on this: `useReorderResources` patches
   * every cached list and `useReassignAppointmentResource` patches every
   * cached window, both via `setQueriesData` on the PREFIX. Handing those an
   * exact `list(params)` / `allocations(range)` key would silently narrow the
   * match to whichever variant the caller happened to name and leave the
   * others showing the pre-drag order — the same class of silent no-op this
   * whole factory exists to prevent. Hence the explicit `allLists()` /
   * `allAllocations()` / `allUtilisation()` producers: at a call site it is
   * unmistakable which one you asked for.
   */
  resources: {
    all: () => key('resources'),
    categories: () => key('resources', 'categories'),
    /** Prefix over every filter variant of the resource list. */
    allLists: () => key('resources', 'list'),
    list: (params: unknown) => key('resources', 'list', params),
    requirements: (serviceId: string) =>
      key('resources', 'requirements', serviceId),
    /** Prefix over every calendar window. */
    allAllocations: () => key('resources', 'allocations'),
    allocations: (range: unknown) => key('resources', 'allocations', range),
    /** Prefix over every reporting range. */
    allUtilisation: () => key('resources', 'utilisation'),
    utilisation: (range: unknown) => key('resources', 'utilisation', range),
  },

  /**
   * The curated stock-footage catalogue (global, not org-scoped). `list` is
   * keyed by the service the clips were matched against plus the media type,
   * because the same service resolves a different set for video vs image.
   */
  /**
   * The media library. Every assets query hangs off this root — the list, the
   * per-asset read, the per-batch list — so `all()` refreshes all of them,
   * which is what the background analysis tracker needs when tags land.
   */
  assets: {
    all: () => key('assets'),
  },

  stockClips: {
    all: () => key('stock-clips'),
    list: (serviceId: string | null, mediaType: 'video' | 'image') =>
      key('stock-clips', serviceId, mediaType),
  },

  /**
   * Point-of-sale sales. `list` is the root the sales table reads; the daily
   * summary hangs off the same root, so `all()` refreshes both.
   */
  sales: {
    all: () => key('sales'),
    list: () => key('sales', 'list'),
  },

  /**
   * Monthly content batches and the per-post review threads beneath them.
   *
   * `all()` is the prefix the accept / reject / regenerate / refine mutations
   * invalidate, and it deliberately reaches `current()` — the review workspace
   * and the planner both read that key, so deciding any post refreshes both.
   *
   * A thread is keyed by ITEM, never by batch: threads are per-post by design,
   * and a batch-wide key would let one post's history bleed into another's
   * panel.
   */
  contentBatches: {
    all: () => key('content-batches'),
    current: () => key('content-batches', 'current'),
    itemMessages: (itemId: string) =>
      key('content-batches', 'items', itemId, 'messages'),
    itemClips: (itemId: string) =>
      key('content-batches', 'items', itemId, 'clips'),
    /**
     * Which cut is live on an item, and whether it has been made yet.
     *
     * Keyed on the ATTEMPT as well: a card in a transcript reads the attempt it
     * was emitted against, and two cards on the same item legitimately want
     * different answers.
     */
    itemState: (itemId: string, attemptId?: string) =>
      key('content-batches', 'items', itemId, 'state', attemptId ?? 'current'),
  },

  /**
   * A rendered piece of content, polled while it renders.
   *
   * One key per asset, SHARED by the card that started the render and the panel
   * showing it — so a single poll feeds both and they can never disagree about
   * whether it has finished.
   */
  content: {
    video: (videoId: string) => key('videos', videoId),
    graphic: (graphicId: string) => key('graphics', graphicId),
    /** Whichever of the two, for the kind-agnostic panel. */
    asset: (kind: 'video' | 'graphic', id: string) =>
      key(kind === 'video' ? 'videos' : 'graphics', id),
  },

  /**
   * Claire's own state. `memories` is what the settings page lists;
   * `contentRules` is the same knowledge_entry store narrowed to org-wide copy
   * rules, so saving one invalidates both — the same rows render in two places.
   */
  assistant: {
    all: () => key('assistant'),
    memories: () => key('assistant', 'memories'),
    contentRules: () => key('assistant', 'content-rules'),
  },

  /**
   * Curated graphic style registry (`GET /graphics/templates`). Static per
   * deploy — read by the generate-graphic style picker.
   */
  graphics: {
    all: () => key('graphics'),
    templates: (usageType: string) => key('graphics', 'templates', usageType),
  },

  /**
   * Team members. `all()` is the prefix over the list AND every
   * `['practitioners', id]` detail query, which is what the calendar and the
   * public booking page render.
   */
  practitioners: {
    all: () => key('practitioners'),
    detail: (practitionerId: string) => key('practitioners', practitionerId),
  },

  invitations: {
    all: () => key('invitations'),
    pending: () => key('invitations', 'pending'),
  },

  onboarding: {
    all: () => key('onboarding'),
    session: () => key('onboarding', 'session'),
  },

  /**
   * Plan, credits and invoices. The existing billing queries predate this
   * factory (raw keys, grandfathered in the ratchet); `all` is the root they
   * share, and what a mutation invalidates to refresh every one of them.
   */
  billing: {
    all: () => key('billing'),
  },

  /**
   * Internal staff console. Cross-tenant by design, so every key carries the
   * organization id it was read for — two orgs must never share a cache entry.
   */
  adminTerminal: {
    all: () => key('admin-terminal'),
    /** What an org already has attached: subscription, Stripe account, Meta. */
    onboarding: (organizationId: string) =>
      key('admin-terminal', 'organizations', organizationId, 'onboarding'),
    /** Meta connections authorised but not yet attached to a workspace. */
    metaPending: () => key('admin-terminal', 'meta', 'pending'),
    /** The shareable Meta onboarding link — one per environment. */
    selfServeMetaLink: () => key('admin-terminal', 'meta', 'self-serve-link'),
    /** The shareable Stripe onboarding link — one per environment. */
    selfServeStripeLink: () =>
      key('admin-terminal', 'stripe', 'self-serve-link'),
  },

  integrations: {
    all: () => key('integrations'),

    /** Prefix over every Meta Ads query: integration, pages, lead forms. */
    metaAds: () => key('integrations', 'meta-ads'),
    metaAdsIntegration: () => key('integrations', 'meta-ads', 'integration'),
    metaAdsPages: () => key('integrations', 'meta-ads', 'pages'),
    metaAdsLeadForms: () => key('integrations', 'meta-ads', 'lead-forms'),

    /** Prefix over the Stripe Connect queries (account status). */
    stripe: () => key('integrations', 'stripe'),
    stripeTaxCodes: () => key('integrations', 'stripe', 'tax-codes'),

    whatsappAccounts: () => key('integrations', 'whatsapp', 'accounts'),
    emailAccounts: () => key('integrations', 'email', 'accounts'),
    calendarAccounts: () => key('integrations', 'calendar', 'accounts'),
    bookingAccounts: () => key('integrations', 'booking', 'accounts'),
  },

  /**
   * Meta ADS — the ads and their campaigns, as opposed to the Meta *integration*
   * above. Every one of these roots is already defined by a real query
   * (`list-ads`, `get-ad`, the campaign list); they predate this factory and
   * spell themselves raw, which the ratchet grandfathers. Named here so new
   * hooks can stop adding literals — a mutation that invalidates the ads list
   * must hit the SAME root the list defines or the swap it just made keeps
   * showing the old creative.
   */
  metaAds: {
    all: () => key('meta-ads'),
    detail: (adId: string) => key('meta-ads', adId),
    campaigns: () => key('meta-campaigns'),
  },

  /**
   * Bulk messaging campaigns. Most campaign queries predate this factory (raw
   * keys, grandfathered in the ratchet). These are the roots new composer hooks
   * use: `whatsappTemplates` is the org's synced template list (also invalidated
   * after ensuring the canonical template exists) and `sampleRecipients` powers
   * the live mail-merge preview. Both sit under the `campaigns` root real
   * campaign queries already define.
   */
  campaigns: {
    all: () => key('campaigns'),
    whatsappTemplates: () => key('campaigns', 'whatsapp-templates'),
    sampleRecipients: (
      channel: string,
      filterJson: unknown,
      limit: number | null
    ) => key('campaigns', 'sample-recipients', channel, filterJson, limit),
  },

  /**
   * Team members pulled from a connected booking provider. Its own root, not a
   * child of `integrations` — kept as-is because that is the root the live
   * query actually uses (`list-external-team-members`).
   */
  externalTeamMembers: {
    all: () => key('booking-accounts'),
    forAccount: (accountId: string) =>
      key('booking-accounts', accountId, 'team-members'),
  },

  /** Consultation / consent / intake forms and their submissions. */
  intakeForms: {
    all: () => key('intake-forms'),
    list: (params?: unknown) => key('intake-forms', 'list', params),
    detail: (id: string) => key('intake-forms', id),
    submissions: () => key('intake-forms', 'submissions'),
    leadSubmissions: (leadId: string) =>
      key('intake-forms', 'submissions', 'lead', leadId),
    serviceForms: (serviceId: string) =>
      key('intake-forms', 'service', serviceId),
    fill: (organizationSlug: string, token: string) =>
      key('intake-forms', 'fill', organizationSlug, token),
  },

  /** The public venue page config + its gallery photos. */
  venue: {
    all: () => key('venue'),
    config: (organizationSlug: string, locationSlug?: string) =>
      key('venue', organizationSlug, locationSlug),
    photos: (locationId: string) => key('venue', 'photos', locationId),
  },

  /**
   * Treatment consent forms, STAFF side (ENG-647): the templates a clinic
   * authors and which services require them.
   *
   * `submissions` sits under its own root rather than beneath `all()` on
   * purpose — editing a template must not invalidate who has already signed
   * one, because a submission froze its own snapshot at send time.
   */
  consentFormTemplates: {
    all: () => key('consent-form-templates'),
    list: (params?: unknown) => key('consent-form-templates', 'list', params),
    serviceRequirements: (serviceId: string) =>
      key('consent-form-templates', 'service-requirements', serviceId),
  },
  consentFormSubmissions: {
    all: () => key('consent-form-submissions'),
    forAppointment: (appointmentId: string) =>
      key('consent-form-submissions', appointmentId),
  },

  /** The staff-side unified client profile (ENG-647). */
  leads: {
    all: () => key('leads'),
    profile: (leadId: string) => key('leads', leadId, 'profile'),
    /** `GET leads/stage-counts` — the Clients tab badges (unify-customers). */
    stageCounts: () => key('leads', 'stage-counts'),
  },
} as const;

/**
 * Invalidate by factory key. A raw array is a **compile error** here — which is
 * the point: you cannot reach this function with a key nothing defines.
 *
 * ```ts
 * invalidateKeys(queryClient, queryKeys.organization.all(), queryKeys.auth.session());
 * ```
 */
export function invalidateKeys(
  client: QueryClient,
  ...keys: readonly AppQueryKey[]
): void {
  for (const queryKey of keys) {
    client.invalidateQueries({ queryKey });
  }
}
