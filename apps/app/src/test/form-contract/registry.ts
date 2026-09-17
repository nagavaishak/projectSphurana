/**
 * THE registry. One list of every write operation that has a form behind it.
 *
 * This replaces `multi-surface-forms.ts`, and with it the sprawl it grew: a
 * coverage ratchet, a defaults checker, two source-text rules and ~15 bespoke
 * parity specs, each answering one question and none of them saying what the
 * others were for. There is now one list and one harness, and the harness proves
 * the same four properties for every entry (see `harness.tsx`).
 *
 * Each entry names:
 *   - the SHARED CORE: the single schema + typed defaults factory + field
 *     registry + payload builder that every surface of the operation renders
 *     from. One core is what makes drift impossible rather than merely detected.
 *   - the CONTRACT: the spec that hands the harness this form's descriptor.
 *
 * `coverage.test.ts` fails if an entry has neither on disk, if two entries claim
 * the same operation, or if a contract spec exists that nobody registered. The
 * count is a ratchet: it may grow, never shrink.
 */

export interface RegisteredForm {
  /** Normalised endpoint, e.g. `PUT practitioners/:id`. */
  operation: string;
  /** One-line description of the domain operation. */
  description: string;
  /** Path (from apps/app/) to the shared core: schema + defaults + fields + builder. */
  sharedCore: string;
  /** Path (from apps/app/) to the spec that runs the harness for this form. */
  contract: string;
  /** The surfaces that must agree. Two or more means property 4 is live. */
  surfaces: string[];
  /**
   * Set when this operation is driven by a registered entity editor
   * (`/create/:entity`). `entity-editor-coverage.test.ts` requires every
   * registered editor slug to appear on exactly one entry here — so a new
   * editor cannot ship without a form contract.
   */
  entitySlug?: string;
  /**
   * Set ONLY when the operation has no user-facing form — a body built from
   * `window.location`, or from a row the user clicked rather than fields they
   * filled. Properties 1 and 2 have nothing to check for these; 3 and 4 still
   * do. The ratchet below caps how many there may be.
   */
  noForm?: string;
}

export const REGISTERED_FORMS: RegisteredForm[] = [
  {
    operation: 'POST appointments',
    description: 'Create appointment',
    sharedCore: 'src/features/appointments/create',
    contract: 'src/features/appointments/create-appointment.contract.test.tsx',
    surfaces: [
      'desktop add-appointment-dialog',
      'mobile calendar/new funnel',
      'mobile add-booking drawer',
    ],
  },
  {
    operation: 'PUT appointments/:id',
    description: 'Update / reschedule appointment',
    sharedCore: 'src/features/appointments/api/update-appointment',
    contract: 'src/features/appointments/update-appointment.contract.test.tsx',
    surfaces: [
      'calendar drag/resize + edit-event-dialog',
      'quick-actions (note / reschedule / no-show)',
      'status-progression',
      'mobile booking-detail sheet',
    ],
  },
  {
    operation: 'POST blocked-time',
    description: 'Create blocked time',
    sharedCore: 'src/features/scheduling/blocked-time',
    contract:
      'src/features/scheduling/blocked-time/blocked-time.contract.test.tsx',
    surfaces: ['desktop blocked-time-dialog', 'mobile blocked-time funnel'],
  },
  {
    operation: 'POST|PUT organization-services',
    description: 'Create / update service',
    sharedCore: 'src/features/services-dashboard/service-form',
    contract:
      'src/features/services-dashboard/service-form/service-form.contract.test.tsx',
    // ONE surface since the unified editor landed. This operation used to have
    // two (a desktop dialog and a separate mobile funnel), which is exactly the
    // drift PROPERTY 4 exists to catch — the editor removes the possibility
    // rather than detecting it. `entitySlug` links this operation to its
    // registered editor; entity-editor-coverage.test.ts fails if an editor is
    // registered with no operation here.
    entitySlug: 'service',
    surfaces: ['unified entity editor (/create/service, /edit/service/:id)'],
  },
  {
    operation: 'POST leads',
    description: 'Create lead / client',
    sharedCore: 'src/features/leads/api/create-lead',
    contract: 'src/features/leads/create-lead.contract.test.tsx',
    // The Clients page's primary action is now the unified editor. The dialog
    // stays as an in-context quick-add (till, calendar), where a navigation
    // would lose a half-finished sale or booking — so this operation keeps
    // FOUR surfaces and PROPERTY 4 stays live. They share one controller
    // (`useCreateLeadForm`) and one set of field components, so the parity is
    // structural rather than merely asserted.
    entitySlug: 'customer',
    surfaces: [
      'unified entity editor (/create/customer, /edit/customer/:id)',
      'CreateLeadDialog',
      'appointment mobile new-client',
      'add-booking drawer new-client',
    ],
  },
  {
    operation: 'PUT leads/:id',
    description: 'Update lead / client',
    sharedCore: 'src/features/leads/api/update-lead',
    contract: 'src/features/leads/update-lead.contract.test.tsx',
    surfaces: ['lead-detail-panel', 'client-details-tab'],
  },
  {
    operation: 'PUT practitioners/:id',
    description: 'Update team member',
    sharedCore: 'src/features/practitioners/api/update-practitioner',
    contract:
      'src/features/practitioners/update-practitioner.contract.test.tsx',
    surfaces: [
      'practitioner-dialog',
      'unified entity editor (/edit/team-member/:id)',
      'onboarding setup-profile',
      'team-member-wizard',
    ],
  },
  {
    operation: 'POST practitioners',
    description: 'Create team member',
    sharedCore: 'src/features/practitioners/api/create-team-member',
    contract: 'src/features/practitioners/create-team-member.contract.test.tsx',
    // NOT the invited wizard — it never POSTs, it only PUTs the linked
    // practitioner. ONE surface since the unified editor landed: the bespoke
    // full-screen editor had a desktop-nav layout and a mobile-tab layout that
    // were separate navigation code paths, and the shared editor is one tree
    // laid out in CSS — the drift is now unspellable rather than merely checked.
    entitySlug: 'team-member',
    surfaces: [
      'unified entity editor (/create/team-member, /edit/team-member/:id)',
    ],
  },
  {
    operation: 'PUT practitioners/:id/services',
    description: 'Assign practitioner services',
    sharedCore:
      'src/features/practitioners/api/assign-practitioner-services/assign-practitioner-services.payload.ts',
    contract:
      'src/features/practitioners/assign-practitioner-services.contract.test.tsx',
    surfaces: [
      'unified entity editor (team-member Services section)',
      'service-form team assignment',
    ],
  },
  {
    operation: 'PUT practitioners/:id/locations',
    description: 'Assign practitioner locations',
    sharedCore:
      'src/features/practitioners/api/assign-practitioner-locations/assign-practitioner-locations.payload.ts',
    contract:
      'src/features/practitioners/assign-practitioner-locations.contract.test.tsx',
    surfaces: ['unified entity editor (team-member Locations section)'],
  },
  {
    operation: 'POST lead-forms',
    description: 'Create Meta lead form',
    sharedCore: 'src/features/lead-forms/components/lead-form.form.ts',
    contract: 'src/features/lead-forms/lead-form.contract.test.tsx',
    // TWO surfaces, deliberately. The unified editor is where lead forms are
    // created and edited; `CreateLeadFormDialog` survives ONLY inside the
    // campaign-creation modal, where navigating to a page would throw away a
    // half-filled campaign draft. Both run the same validator and the same
    // `leadFormBuilderToInput`, and PROPERTY 4 holds them to one body.
    entitySlug: 'lead-form',
    surfaces: [
      'unified entity editor (/create/lead-form, /edit/lead-form/:id)',
      'CreateLeadFormDialog (campaign modal wizard)',
    ],
  },
  {
    operation: 'PATCH organization',
    description: 'Update organization settings',
    sharedCore: 'src/features/organization/api/update-organization',
    contract: 'src/features/organization/update-organization.contract.test.tsx',
    surfaces: [
      'settings/details route',
      'settings/style route',
      'org-settings dialog tabs',
    ],
  },
  {
    operation: 'PUT users/:id',
    description: 'Update user profile',
    sharedCore: 'src/features/user/api/update-user',
    contract: 'src/features/user/update-user.contract.test.tsx',
    surfaces: ['settings/index route', 'user-settings profile tab'],
  },
  {
    operation: 'POST social-posts',
    description: 'Create social post',
    sharedCore: 'src/features/social-posts/api/create-social-post',
    contract: 'src/features/social-posts/create-social-post.contract.test.tsx',
    surfaces: [
      'content-calendar add-content-dialog',
      'mobile content wizard',
      'content-studio post-content-dialog',
    ],
  },
  {
    operation: 'PUT social-posts/:id',
    description: 'Update social post',
    sharedCore: 'src/features/social-posts/api/update-social-post',
    contract: 'src/features/social-posts/update-social-post.contract.test.tsx',
    surfaces: [
      'social-post-panel',
      'content-calendar provider',
      'mobile post-detail',
    ],
  },
  {
    operation: 'POST meta-campaigns',
    description: 'Create ad campaign',
    sharedCore: 'src/features/meta-campaigns/components/create-campaign-form',
    contract: 'src/features/meta-campaigns/create-campaign.contract.test.tsx',
    surfaces: [
      'desktop create-campaign-modal',
      'mobile campaign-create funnel',
    ],
  },
  {
    operation: 'POST meta-ads',
    description: 'Create ad',
    sharedCore: 'src/features/meta-ads/api/create-ad',
    contract:
      'src/routes/_authed/ads/new/-components/create-ad.contract.test.tsx',
    surfaces: ['desktop ad-wizard', 'mobile ad-wizard'],
  },
  {
    operation: 'POST meta-ads/launch',
    description: 'Launch ad',
    sharedCore: 'src/features/meta-ads/api/launch-ad',
    contract:
      'src/routes/_authed/ads/new/-components/launch-ad.contract.test.tsx',
    surfaces: ['desktop ad-wizard', 'mobile ad-wizard'],
  },
  {
    operation: 'POST campaigns',
    description: 'Create messaging campaign',
    sharedCore: 'src/features/campaigns/api/send-campaign',
    contract: 'src/features/campaigns/send-campaign.contract.test.tsx',
    surfaces: ['desktop campaign-composer', 'mobile campaign-composer'],
  },
  {
    operation: 'POST membership-plans',
    description: 'Create membership plan',
    sharedCore: 'src/features/memberships/membership-form',
    contract:
      'src/features/memberships/membership-form/membership-plan.contract.test.tsx',
    // ONE surface since the unified editor landed — the dialog it replaced is
    // deleted, so there is nothing left to drift from.
    entitySlug: 'membership',
    surfaces: [
      'unified entity editor (/create/membership, /edit/membership/:id)',
    ],
  },
  {
    operation: 'PUT offers/:id',
    description: 'Update offer',
    sharedCore: 'src/features/offers/api/offer-payload.ts',
    contract: 'src/features/offers/components/offer.contract.test.tsx',
    // The promotions LIST now edits through the unified editor. The dialog
    // survives only inside the create-video wizard, and both render the same
    // fields around the same controller (`src/features/offers/offer-form`).
    entitySlug: 'promotion',
    surfaces: [
      'unified entity editor (/create/promotion, /edit/promotion/:id)',
      'Claire offer draft/publish',
    ],
  },
  {
    operation: 'POST suppliers',
    description: 'Create supplier',
    sharedCore: 'src/features/inventory/api/create-supplier',
    contract: 'src/features/inventory/create-supplier.contract.test.tsx',
    surfaces: ['SupplierDialog', 'stock-order supplier picker (inline create)'],
  },
  {
    operation: 'POST stock-takes',
    description: 'Start stocktake',
    sharedCore: 'src/features/inventory/api/create-stock-take',
    contract: 'src/features/inventory/stock-take.contract.test.tsx',
    // ONE surface since the create dialog became the unified entity editor.
    entitySlug: 'stock-take',
    surfaces: ['unified entity editor (/create/stock-take)'],
  },
  {
    operation: 'POST stock-orders',
    description: 'Create stock order',
    sharedCore: 'src/features/inventory/api/create-stock-order',
    contract: 'src/features/inventory/stock-order.contract.test.tsx',
    entitySlug: 'stock-order',
    surfaces: ['unified entity editor (/create/stock-order)'],
  },
  {
    operation: 'POST products',
    description: 'Create product',
    sharedCore: 'src/features/inventory/api/create-product',
    contract: 'src/features/inventory/product.contract.test.tsx',
    // Create and update share one builder, so this pins both verbs.
    entitySlug: 'product',
    surfaces: ['unified entity editor (/create/product, /edit/product/:id)'],
  },
  {
    operation: 'POST product-brands',
    description: 'Create product brand',
    sharedCore: 'src/features/inventory/api/create-product-brand',
    contract: 'src/features/inventory/create-product-brand.contract.test.tsx',
    surfaces: ['ProductBrandDialog', 'product-editor brand picker'],
  },
  {
    operation: 'POST product-categories',
    description: 'Create product category',
    sharedCore: 'src/features/inventory/api/create-product-category',
    contract:
      'src/features/inventory/create-product-category.contract.test.tsx',
    surfaces: ['ProductCategoryDialog', 'product-editor category picker'],
  },
  {
    operation: 'PUT integrations/instagram/chatbot',
    description: 'Toggle Instagram chatbot',
    noForm:
      'A gesture, not a field: the three surfaces share no control — two switches with different labels, and an enable-only onboarding button with no toggle at all.',
    sharedCore:
      'src/features/integrations/api/toggle-instagram-chatbot/toggle-instagram-chatbot.payload.ts',
    contract:
      'src/features/integrations/toggle-instagram-chatbot.contract.test.tsx',
    surfaces: [
      'chatbot-page-toggles',
      'facebook-settings-dialog',
      'instagram-chatbot-dialog',
    ],
  },
  {
    operation: 'POST assets',
    description: 'Create asset',
    sharedCore: 'src/features/assets/api/create-asset',
    contract: 'src/features/assets/create-asset.contract.test.tsx',
    surfaces: ['10 upload/generate surfaces — worst offender'],
  },
  // `POST assets` is one endpoint written by several call sites that build
  // DELIBERATELY different bodies — an edited clip carries `source: 'edited'` and
  // a batchId, an onboarding capture carries `captureFromFile`, a background clip
  // carries `tags: ['background']`. Different body = different operation, so they
  // get their own parity sets rather than being forced into one.
  {
    operation: 'POST assets (mass video upload)',
    description: 'Create asset — edited clip from the mass upload dialog',
    sharedCore: 'src/features/assets/api/create-asset',
    contract:
      'src/features/social-posts/create-asset-mass-upload.contract.test.tsx',
    surfaces: ['mass-video-upload-dialog'],
    noForm:
      "The body is derived from the File plus call-site context (source: 'edited', batchId); no user-editable field exists.",
  },
  {
    operation: 'POST assets (onboarding capture)',
    description: 'Create asset — onboarding capture upload',
    sharedCore: 'src/features/assets/api/create-asset',
    contract: 'src/features/onboarding/create-asset-capture.contract.test.tsx',
    surfaces: ['onboarding upload-assets upload-context'],
    noForm:
      'The body is derived from the File plus captureFromFile/batchId context; no user-editable field exists.',
  },
  {
    operation: 'POST assets (video clip)',
    description: 'Create asset — background clip for the video editor',
    sharedCore: 'src/features/assets/api/create-asset',
    contract: 'src/features/videos/create-asset-clip.contract.test.tsx',
    surfaces: [
      'single-clip-slot',
      'video-selection-dialog',
      'media-selection-step',
    ],
    noForm:
      "The body is derived from the File plus tags: ['background']; no user-editable field exists.",
  },
  {
    operation: 'POST videos',
    description: 'Create video',
    sharedCore: 'src/features/videos/api/create-video',
    contract: 'src/features/videos/create-video.contract.test.tsx',
    surfaces: ['create-video wizard', 'create-from-client', 'ads video-format'],
  },
  {
    operation: 'PUT videos/:id',
    description: 'Update video draft',
    sharedCore: 'src/features/videos/api/update-video',
    contract: 'src/features/videos/update-video.contract.test.tsx',
    surfaces: ['video-creation-form', 'video-draft-preview'],
  },
  {
    operation: 'POST videos/generate-script',
    description: 'Generate video script',
    sharedCore: 'src/features/videos/api/generate-video-script',
    contract: 'src/features/videos/generate-video-script.contract.test.tsx',
    surfaces: ['multiple generate entry points'],
  },
  {
    operation: 'POST videos/generate-organic-copy',
    description: 'Generate organic copy',
    sharedCore: 'src/features/videos/api/generate-organic-copy',
    contract: 'src/features/videos/generate-organic-copy.contract.test.tsx',
    surfaces: ['multiple generate entry points'],
  },
  {
    operation: 'PUT face-groups/:id',
    description: 'Update face group',
    sharedCore: 'src/features/face-groups/api/update-face-group',
    contract: 'src/features/face-groups/update-face-group.contract.test.tsx',
    surfaces: ['3 surfaces'],
  },
  {
    operation: 'POST graphics/generate',
    description: 'Generate graphic',
    sharedCore: 'src/features/graphics/api/generate-graphic',
    contract: 'src/features/graphics/generate-graphic.contract.test.tsx',
    surfaces: ['new-post-dialog', 'gallery/new wizard'],
  },
  {
    operation: 'POST ai-content/generate',
    description: 'Generate AI content',
    sharedCore: 'src/features/ai-content/api/generate-content',
    contract: 'src/features/ai-content/generate-content.contract.test.tsx',
    surfaces: ['2 surfaces'],
  },
  {
    operation: 'POST ai-content/generate-offer-copy',
    description: 'Generate offer copy',
    sharedCore: 'src/features/ai-content/api/generate-offer-copy',
    contract: 'src/features/ai-content/generate-offer-copy.contract.test.tsx',
    surfaces: ['2 surfaces'],
  },
  {
    operation: 'POST integrations/stripe/account-link',
    description: 'Create Stripe account link',
    noForm:
      'The body is two URLs derived from window.location; the user only clicks.',
    sharedCore: 'src/features/stripe-connect/api/create-account-link',
    contract:
      'src/features/stripe-connect/create-account-link.contract.test.tsx',
    surfaces: ['2 surfaces build returnUrl/refreshUrl'],
  },
  {
    operation: 'POST voice-scripts',
    description: 'Create voice script',
    sharedCore: 'src/features/voice-scripts/api/create-voice-script',
    contract:
      'src/features/voice-scripts/create-voice-script.contract.test.tsx',
    surfaces: ['onboarding step-3 editor', 'VoicePanel', 'DirectiveCard'],
  },
  {
    operation: 'PUT voice-scripts/:id',
    description: 'Update voice script',
    sharedCore: 'src/features/voice-scripts/api/update-voice-script',
    contract:
      'src/features/voice-scripts/update-voice-script.contract.test.tsx',
    surfaces: ['onboarding step-3 editor', 'VoicePanel', 'DirectiveCard'],
  },
  {
    operation: 'POST content-batches/items/:id/accept',
    description: 'Accept content batch item',
    sharedCore: 'src/features/content-batches/api/accept-batch-item',
    contract:
      'src/features/content-batches/accept-batch-item.contract.test.tsx',
    surfaces: ['batch-review-dialog', 'content-approval-slide'],
  },
  {
    operation: 'POST organization-locations',
    description: 'Create location',
    sharedCore: 'src/features/organization-locations/location-form',
    contract: 'src/features/organization-locations/location.contract.test.tsx',
    // ONE surface: the unified editor replaced the AddLocationDialog outright,
    // so there is no second create form to drift from. The onboarding wizard
    // creates the org's first location through its own step and its own body;
    // it is not a surface of this form.
    entitySlug: 'location',
    surfaces: ['unified entity editor (/create/location)'],
  },
  {
    operation: 'PUT organization-locations/:id',
    description: 'Update location',
    sharedCore: 'src/features/organization-locations/location-form',
    contract:
      'src/features/organization-locations/update-location.contract.test.tsx',
    // Shares its field specs with the create form (`RECORD_FIELDS`) but NOT its
    // wire contract: update is PATCH-shaped, so `isPrimary` has no default and
    // the required address fields may be left alone but not blanked. The
    // catalogue tabs are a different endpoint on an existing branch, so they
    // are absent from this body by construction.
    surfaces: ['unified entity editor (/edit/location/:id)'],
  },
];
