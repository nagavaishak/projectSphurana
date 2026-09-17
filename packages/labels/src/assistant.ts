/**
 * AI Assistant enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Assistant message role labels
export const assistantMessageRoleLabels = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
} as const;

export const assistantMessageRoleValues = Object.keys(
  assistantMessageRoleLabels
) as [
  keyof typeof assistantMessageRoleLabels,
  ...(keyof typeof assistantMessageRoleLabels)[],
];

export type AssistantMessageRole = keyof typeof assistantMessageRoleLabels;

// Knowledge entry type labels
export const knowledgeEntryTypeLabels = {
  org_profile: 'Organization Profile',
  service: 'Service',
  ad_insight: 'Ad Insight',
  post_insight: 'Post Insight',
  video_preference: 'Video Preference',
  customer_pattern: 'Customer Pattern',
  area_info: 'Area Info',
  industry_benchmark: 'Industry Benchmark',
  faq: 'FAQ',
  chatbot_insight: 'Chatbot Insight',
  // Phase 4 (claire.md §2 Q4 — locked) — three knowledge populators write
  // these three new types. `preference` is what the `remember` factory tool
  // writes when the user expresses a stable preference; scope `(orgId, userId)`.
  // `conversation_summary` is what the post-conversation hook in
  // `assistant-chat.controller.ts onFinish` writes after every successful turn
  // (rate-limited to once per hour per conversation in the service layer);
  // scope `(orgId, userId)`. `operational_snapshot` is what the nightly cron
  // writes (W-C13-operational-snapshots) — one row per org per day,
  // scope `(orgId, null)`, 7-day expiry, deterministic templated prose.
  preference: 'Preference',
  conversation_summary: 'Conversation Summary',
  operational_snapshot: 'Operational Snapshot',
} as const;

export const knowledgeEntryTypeValues = Object.keys(
  knowledgeEntryTypeLabels
) as [
  keyof typeof knowledgeEntryTypeLabels,
  ...(keyof typeof knowledgeEntryTypeLabels)[],
];

export type KnowledgeEntryType = keyof typeof knowledgeEntryTypeLabels;

// Knowledge source labels
export const knowledgeSourceLabels = {
  auto: 'Auto-generated',
  ai: 'AI-generated',
  manual: 'Manual',
} as const;

export const knowledgeSourceValues = Object.keys(knowledgeSourceLabels) as [
  keyof typeof knowledgeSourceLabels,
  ...(keyof typeof knowledgeSourceLabels)[],
];

export type KnowledgeSource = keyof typeof knowledgeSourceLabels;

// =============================================================================
// Claire-Owner additions (v2): recommendations + conversation escalation
// Backend keeps the `assistant_` prefix; "Claire" is a UI/brand name only.
// See docs/plans/claire-spec-v2.md Decision 7 for the recommendation catalogue.
// =============================================================================

// Conversation status — supports the one-click escalation handoff
// (assistant_conversation.status column added in this change)
export const assistantConversationStatusLabels = {
  active: 'Active',
  escalated: 'Escalated',
} as const;

export const assistantConversationStatusValues = Object.keys(
  assistantConversationStatusLabels
) as [
  keyof typeof assistantConversationStatusLabels,
  ...(keyof typeof assistantConversationStatusLabels)[],
];

export type AssistantConversationStatus =
  keyof typeof assistantConversationStatusLabels;

// Recommendation kinds — 16 values seeded for v2.
// 12 are active in v2 ship; 4 prompt_* kinds are seeded for phase v2.1/v2.2
// (create_offer / video / graphic / post tours wired by the other dev).
// Paused (not seeded): onboarding_*, seasonal_*, edge_*, weekly_report_preview.
export const assistantRecommendationKindLabels = {
  // Content
  content_no_post_14_days: "Haven't posted in 14 days",
  content_unused_assets: 'Unused content ready to use',
  content_learning_phase_prompt: 'Make content while your ad is learning',

  // Leads
  lead_first_of_session: 'New lead in',
  lead_unreplied_2h: 'A lead is waiting for a reply',
  lead_flagged_problem: 'A lead needs a human',
  booking_confirmed: 'Booking confirmed',
  pre_appointment_prep: 'Appointment coming up',

  // Campaign lifecycle
  learning_phase_reassurance: 'Your ad is learning',
  creative_refresh_needed: 'Time for a new video',
  campaign_learning_phase_exit: 'Your ad has finished learning',

  // Tour prompts — only prompt_create_first_ad is active in v2.
  prompt_create_first_ad: 'Ready to create your first ad',
  prompt_create_first_offer: 'Create your first offer',
  prompt_record_first_video: 'Record your first video',
  prompt_create_first_graphic: 'Create your first graphic',
  prompt_create_first_post: 'Create your first post',

  // Phase 4 — Lifecycle recommendation triggers (W-C16-lifecycle-triggers).
  // Both fire daily; navigate to /assistant?prefill=… so the operator lands
  // in a chat seeded with the right question rather than a destination page.
  no_show_surge: 'No-show rate is climbing',
  offer_expiring_soon: 'Offers expiring this week',

  // Phase 4 — Performance recommendation triggers (W-C16-perf-triggers).
  // All fire daily. cpl_spike + creative_burnout skip campaigns still in
  // Meta's learning phase (≤10 days since launch) per the shared-spec hard
  // block; lead_volume_drop enforces a 5-leads/week floor to suppress noise
  // on low-volume orgs. Each navigates to /assistant?prefill=… so Claire
  // can pull the actual numbers and walk the operator through next steps.
  cpl_spike: 'Your CPL is up sharply',
  creative_burnout: 'Your ad creative is burning out',
  lead_volume_drop: 'Lead volume dropped this week',

  // PRD-1 — Campaign Troubleshooting Framework (proactive `fourDayNoLeads`
  // trigger). Fires when a campaign past the €80 spend threshold has gone 4
  // consecutive days with zero high-intent leads. Navigates to
  // /assistant?prefill=… so Claire pulls the data and walks the owner through
  // the diagnose → adjust-offer → refresh-creative → escalate loop.
  campaign_no_leads_4d: 'A campaign has gone quiet',

  // Recommendation engine (Claire-engine) — telemetry kinds for the
  // accept/dismiss/actioned lifecycle attached to per-flow picks and to the
  // classifier disagreement surface (see docs/implementations/claire-recommendation-engine).
  ad_flow_service_pick: 'Service pick — ad creation flow',
  ad_flow_offer_pick: 'Offer pick — ad creation flow',
  classifier_disagreement: 'Classification disagreement surfaced',
} as const;

export const assistantRecommendationKindValues = Object.keys(
  assistantRecommendationKindLabels
) as [
  keyof typeof assistantRecommendationKindLabels,
  ...(keyof typeof assistantRecommendationKindLabels)[],
];

export type AssistantRecommendationKind =
  keyof typeof assistantRecommendationKindLabels;

// Primary-action type on a recommendation — what clicking Accept does.
export const assistantActionTypeLabels = {
  navigate: 'Navigate',
  tour: 'Tour',
  none: 'None',
} as const;

export const assistantActionTypeValues = Object.keys(
  assistantActionTypeLabels
) as [
  keyof typeof assistantActionTypeLabels,
  ...(keyof typeof assistantActionTypeLabels)[],
];

export type AssistantActionType = keyof typeof assistantActionTypeLabels;

// Recommendation row state
export const assistantRecommendationStateLabels = {
  active: 'Active',
  dismissed: 'Dismissed',
  actioned: 'Actioned',
  expired: 'Expired',
} as const;

export const assistantRecommendationStateValues = Object.keys(
  assistantRecommendationStateLabels
) as [
  keyof typeof assistantRecommendationStateLabels,
  ...(keyof typeof assistantRecommendationStateLabels)[],
];

export type AssistantRecommendationState =
  keyof typeof assistantRecommendationStateLabels;

// Primary-action shape carried on every recommendation
export interface AssistantPrimaryAction {
  label: string;
  type: AssistantActionType;
  target?: string;
  payload?: Record<string, unknown>;
}
