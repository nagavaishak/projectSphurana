/**
 * Claire (v3) enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports.
 *
 * v3 introduces `claire_*` prefixed tables/enums for tool-factory infrastructure
 * (confirmation tokens, etc.). Pre-existing assistant tables keep their
 * `assistant_*` prefix; "Claire" is the UI/brand name shared with v2.
 *
 * See docs/implementations/claire.md §2 (locked decisions — Backend / Confirmations).
 */

// =============================================================================
// CONFIRMATION TOKEN ACTIONS
// =============================================================================

/**
 * Actions that can require operator confirmation before Claire executes them.
 *
 * Extend as new destructive tools land in Phase 2 / Phase 3 / Phase 6.
 * The label is shown in confirmation UI and audit logs.
 */
export const claireConfirmationActionLabels = {
  launch_ad: 'Launch ad',
  pause_campaign: 'Pause campaign',
  // Resuming RESTARTS SPEND. Pause is the safe direction and is confirmed;
  // leaving resume unconfirmed would gate the reversible half and not the
  // irreversible one.
  resume_campaign: 'Resume campaign',
  update_budget: 'Update budget',
  schedule_post: 'Schedule post',
  publish_post: 'Publish post',
  book_appointment: 'Book appointment',
  reschedule_appointment: 'Reschedule appointment',
  cancel_appointment: 'Cancel appointment',
  mark_no_show: 'Mark no-show',
  create_offer: 'Create offer',
  extend_offer: 'Extend offer',
  expire_offer: 'Expire offer',
  assign_lead_to_sequence: 'Assign lead to sequence',
  escalate_conversation: 'Escalate conversation',
  assign_conversation: 'Assign conversation',
  queue_video_export: 'Queue video for rendering',
  create_campaign: 'Create campaign',
  create_lead: 'Create lead',
  update_lead: 'Update lead',
  create_service: 'Create service',
  update_service: 'Update service',
  // Offering an existing service at more branches. Confirmed like every other
  // catalogue write: it changes what a customer can book, at a branch, within
  // minutes — and unlike the others it is not visible on the service's own
  // page, so an unannounced change would be hard to notice.
  add_service_locations: 'Offer service at more branches',
  send_reply: 'Send reply',
  delete_video_draft: 'Delete video',
  delete_draft_ad: 'Delete draft ad',
  delete_service: 'Delete service',
  delete_social_post_draft: 'Delete social post draft',
  // Re-rolls a queued post: appends a new cut, moves the pointer, spends a
  // render. Confirmed because it costs money and replaces what the post shows —
  // the previous cut stays recoverable through undo.
  regenerate_content_item: 'Make another version of this post',
  // Messaging Campaigns (Phase 7): launching a campaign sends real
  // SMS/email/WhatsApp messages to the audience, so Claire gates it behind
  // an operator confirmation via the factory's destructive flow.
  launch_campaign: 'Launch messaging campaign',
  // Chatbot kill switch (Claire reliability overhaul, Phase 8 / finding #65):
  // turning the customer-facing chatbot on or off per channel changes what
  // live customers experience mid-conversation, so it is an exposed write
  // gated behind an explicit confirmation (ADR-004).
  toggle_chatbot: 'Turn chatbot on/off',
  // Chatbot custom directive (the "top-level override" injected at the head of
  // the customer chatbot's prompt as CUSTOM DIRECTIVE — HIGHEST PRIORITY). It
  // rewrites how the live bot talks to every customer, so setting or clearing
  // it is an exposed write gated behind an explicit confirmation. This is the
  // OVERRIDE only — never the base chatbot system prompt, which Claire cannot
  // touch.
  set_chatbot_directive: 'Set chatbot directive',
} as const;

export const claireConfirmationActionValues = Object.keys(
  claireConfirmationActionLabels
) as [
  keyof typeof claireConfirmationActionLabels,
  ...(keyof typeof claireConfirmationActionLabels)[],
];

export type ClaireConfirmationAction =
  keyof typeof claireConfirmationActionLabels;

// =============================================================================
// ACTION INTENTS (idempotency / duplicate protection — Phase 4)
// =============================================================================

/**
 * Recent normalised Claire action intents, recorded so a repeated request
 * resolves to an in-flight/just-created resource instead of spawning a
 * duplicate (register #79 #95 #151). Each intent row carries a normalised
 * key the dedupe check compares against.
 *
 * Kept deliberately small — only the create/launch actions where a duplicate
 * costs the owner money or clutter.
 */
export const claireActionIntentTypeLabels = {
  create_campaign: 'Create campaign',
  create_lead_form: 'Create lead form',
  launch_ad: 'Launch ad',
} as const;

export const claireActionIntentTypeValues = Object.keys(
  claireActionIntentTypeLabels
) as [
  keyof typeof claireActionIntentTypeLabels,
  ...(keyof typeof claireActionIntentTypeLabels)[],
];

export type ClaireActionIntentType = keyof typeof claireActionIntentTypeLabels;

// =============================================================================
// RECOMMENDATION ENGINE — 3-axis classification + per-vertical strategy
// =============================================================================

/**
 * Business vertical. The recommendation engine ships per-vertical configs.
 * Extend as new verticals are added.
 */
export const businessVerticalLabels = {
  aesthetic_clinic: 'Aesthetic Clinic',
  hair_salon: 'Hair Salon',
  beauty_salon: 'Beauty Salon',
  fitness: 'Fitness / Personal Training',
  dental: 'Dental',
  legal: 'Legal',
} as const;

export const businessVerticalValues = Object.keys(businessVerticalLabels) as [
  keyof typeof businessVerticalLabels,
  ...(keyof typeof businessVerticalLabels)[],
];

export type BusinessVertical = keyof typeof businessVerticalLabels;

/**
 * Retention model — drives service ranking. Favours short rebooking cycles.
 */
export const retentionModelLabels = {
  course_based: 'Course-based (multi-session, fixed cadence)',
  rebooking: 'Single treatment with scheduled rebooking',
  consideration_sale: 'High-ticket, consultation-driven',
} as const;

export const retentionModelValues = Object.keys(retentionModelLabels) as [
  keyof typeof retentionModelLabels,
  ...(keyof typeof retentionModelLabels)[],
];

export type RetentionModel = keyof typeof retentionModelLabels;

/**
 * Commitment level — drives offer strategy (whether price belongs on the ad).
 */
export const commitmentLevelLabels = {
  impulse: 'Impulse purchase',
  planned: 'Planned purchase',
  major: 'Major commitment (consultation expected)',
} as const;

export const commitmentLevelValues = Object.keys(commitmentLevelLabels) as [
  keyof typeof commitmentLevelLabels,
  ...(keyof typeof commitmentLevelLabels)[],
];

export type CommitmentLevel = keyof typeof commitmentLevelLabels;

/**
 * Market position — drives offer strategy (chooses pricing path A/B/C).
 */
export const marketPositionLabels = {
  below: 'Below local market',
  at: 'At local market',
  above: 'Above local market',
  unknown: 'Unknown',
} as const;

export const marketPositionValues = Object.keys(marketPositionLabels) as [
  keyof typeof marketPositionLabels,
  ...(keyof typeof marketPositionLabels)[],
];

export type MarketPosition = keyof typeof marketPositionLabels;

/**
 * Offer strategy — per-service output of the engine. Drives copy + price visibility.
 */
export const offerStrategyLabels = {
  price_visible_intro: 'Show price; intro discount below market',
  switch_service: 'Drop this service; advertise rank-2 instead',
  price_hidden_conversation:
    'Hide price on ad; reveal in chat once intent shown',
  consultation_led: 'No price anywhere; sell the consultation',
  do_not_advertise: 'Do not run cold-traffic; recommend retargeting',
} as const;

export const offerStrategyValues = Object.keys(offerStrategyLabels) as [
  keyof typeof offerStrategyLabels,
  ...(keyof typeof offerStrategyLabels)[],
];

export type OfferStrategy = keyof typeof offerStrategyLabels;
