import type { UIMessage } from 'ai';

export interface ToolPartData {
  type: string;
  state: string;
  toolCallId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
}

export function asToolPart(
  part: UIMessage['parts'][number]
): ToolPartData | null {
  if (!part.type.startsWith('tool-')) return null;
  return part as unknown as ToolPartData;
}

/**
 * Strip the `tool-` part-type prefix AND the `{feature}_` tool-namespace
 * prefix, returning the bare action name (`createCampaign`, not
 * `meta_ads_createCampaign`; `executeVideoExport`, not
 * `videos_executeVideoExport`).
 *
 * The controller registers every factory tool under its canonical
 * `{feature}_{action}` name and that's what flows through the AI SDK to
 * the frontend in part types like `tool-videos_executeVideoExport`. All
 * frontend lookup tables (`RICH_TOOL_NAMES`, `SILENT_TOOLS`,
 * `FRIENDLY_TOOL_LABELS`, the renderer's `toolName === 'X'` checks)
 * are keyed by bare actions, so the normalisation has to happen here —
 * otherwise every rich card silently falls through to the trace badge.
 */
export function getToolName(tp: ToolPartData): string {
  const raw = tp.type.replace('tool-', '');
  if (!raw.includes('_')) return raw;
  return raw.split('_').pop() ?? raw;
}

/** Client tools that pause the AI until the user clicks Approve/Reject */
export const CLIENT_TOOLS = new Set([
  'confirmLaunchAd',
  'confirmPauseAd',
  'confirmUpdateBudget',
]);

/** Tools whose output should be rendered as rich components */
export const RICH_TOOL_NAMES = new Set([
  'createContent',
  'executeVideoExport',
  'getVideoStatus',
  'generateTalkingHeadQR',
  'patchContent',
  'updateAd',
  'replaceAdCreative',
  'confirmLaunchAd',
  'confirmPauseAd',
  'confirmUpdateBudget',
  // Window 7 — Claire chat preview cards
  'claire_showAdPreview',
  'claire_showOfferPreview',
  // Messaging campaigns — interactive review card + modal
  'showCampaignPreview',
]);

/** Server tools that execute silently (no visible UI while running) */
export const SILENT_TOOLS = new Set([
  // Meta infrastructure — plumbing the operator doesn't need to see ever.
  // `meta_loadSkill` runs whenever the model pivots into a new skill, which
  // is several times per conversation; showing "Used 1 tool: Meta_load Skill"
  // adds noise without information.
  'meta_loadSkill',
  'loadSkill',
  'meta_dispatchTour',
  'dispatchTour',
  // Video tools
  'createContent',
  'generateVideoScript',
  'autoSelectClips',
  'listDraftClips',
  'autoSelectMusic',
  'updateDraftConfig',
  // `executeVideoExport` is intentionally NOT silent — its output mounts the
  // `ProcessingStatus` loading card via the tool renderer, so the user sees
  // a progress tile as soon as the render queues.
  // Context / read-only lookups
  'getOrganizationContext',
  'listServices',
  'getServiceDetails',
  'listRecentVideos',
  'listOffers',
  'checkConnectedPages',
  'listRecentPosts',
  'generatePostCaption',
  'suggestPostingTime',
  'createSocialPostDraft',
  'updateSocialPostDraft',
  'executeSchedulePost',
  'executePublishNow',
  // Ad tools (read-only)
  'checkMetaIntegration',
  'listCampaigns',
  'listRecentAds',
  'getAdInsights',
  'getCampaignInsights',
  'suggestAdOptimizations',
  // Ad tools (write)
  'generateAdCopy',
  'createDraftAd',
  'executeLaunchAd',
  'executePauseAd',
  'executeUpdateBudget',
  // Messaging campaigns — reads + draft writes narrate through the model;
  // `showCampaignPreview` (rich card) and `launch` (confirmation) stay visible.
  'previewAudience',
  'listWhatsappTemplates',
  'setMessage',
  'createSegment',
  'checkChannels',
]);

/** Tool types that imply Claire is asking for a destructive confirmation. */
export const CONFIRMATION_TOOLS = new Set([
  'confirmLaunchAd',
  'confirmPauseAd',
  'confirmUpdateBudget',
]);

/**
 * Tools the operator should never see in the trace. These are pure
 * infrastructure (skill loading, UI tour dispatch) — they fire constantly
 * and add no signal. The trace component skips them; the message-list
 * already hides them via `SILENT_TOOLS`.
 */
export const HIDDEN_FROM_TRACE_TOOLS = new Set([
  'meta_loadSkill',
  'loadSkill',
  'meta_dispatchTour',
  'dispatchTour',
]);

/**
 * Friendly labels for tools the operator sees in the trace and header.
 * Keys are bare action names (the form `getToolName` returns). When a tool
 * isn't in this map, the generic transform below kicks in.
 *
 * Mirrors each tool's `presentation.statusLabel` on the backend so the
 * chat-side label matches the in-flight status pill the user already sees.
 */
const FRIENDLY_TOOL_LABELS: Record<string, string> = {
  // Ads
  checkMetaIntegration: 'Checking Meta connection',
  listCampaigns: 'Listing campaigns',
  listRecentAds: 'Listing recent ads',
  getCampaignInsights: 'Loading campaign insights',
  getAdInsights: 'Loading ad insights',
  generateAdCopy: 'Writing ad copy',
  suggestAdOptimizations: 'Looking for ways to improve',
  previewCampaign: 'Previewing campaign',
  createCampaign: 'Creating campaign',
  createDraftAd: 'Creating draft ad',
  updateAd: 'Updating ad',
  replaceAdCreative: 'Replacing ad creative',
  deleteDraftAd: 'Deleting draft ad',
  confirmLaunchAd: 'Asking to launch ad',
  executeLaunchAd: 'Launching ad',
  confirmPauseAd: 'Asking to pause ad',
  executePauseAd: 'Pausing ad',
  confirmUpdateBudget: 'Asking to update budget',
  executeUpdateBudget: 'Updating budget',
  // Context / lookups
  getOrganizationContext: 'Reading clinic context',
  listServices: 'Listing services',
  getServiceDetails: 'Reading service details',
  listRecentVideos: 'Listing recent videos',
  listOffers: 'Listing offers',
  checkConnectedPages: 'Checking connected pages',
  // Videos
  createDraftVideo: 'Creating draft video',
  generateVideoScript: 'Writing video script',
  autoSelectClips: 'Picking clips',
  listDraftClips: 'Listing draft clips',
  autoSelectMusic: 'Picking music',
  updateDraftConfig: 'Updating video',
  queueVideoExport: 'Asking to render video',
  executeVideoExport: 'Rendering video',
  getVideoStatus: 'Checking render status',
  generateTalkingHeadQR: 'Generating QR code',
  listAvailableAssets: 'Listing available assets',
  // Social posts
  listRecentPosts: 'Listing recent posts',
  generatePostCaption: 'Writing caption',
  suggestPostingTime: 'Picking posting time',
  createSocialPostDraft: 'Creating draft post',
  updateSocialPostDraft: 'Updating draft post',
  deleteSocialPostDraft: 'Deleting draft post',
  schedulePost: 'Scheduling post',
  publishPostNow: 'Publishing post',
  confirmSchedulePost: 'Asking to schedule post',
  confirmPublishNow: 'Asking to publish post',
  executeSchedulePost: 'Scheduling post',
  executePublishNow: 'Publishing post',
  // Services
  createService: 'Adding service',
  updateService: 'Updating service',
  deleteService: 'Removing service',
  // Leads
  listLeads: 'Listing leads',
  searchLeads: 'Searching leads',
  getLeadStats: 'Reading lead stats',
  summariseRecentLeads: 'Summarising recent leads',
  createLead: 'Adding lead',
  updateLead: 'Updating lead',
  // Appointments
  findOpenSlots: 'Finding open slots',
  listAppointments: 'Listing appointments',
  summariseUpcomingDay: 'Summarising day',
  bookAppointment: 'Asking to book appointment',
  rescheduleAppointment: 'Asking to reschedule',
  cancelAppointment: 'Asking to cancel',
  // Offers
  getOfferPerformance: 'Reading offer performance',
  createOffer: 'Asking to create offer',
  extendOffer: 'Asking to extend offer',
  expireOffer: 'Asking to expire offer',
  // Conversations
  listOpenConversations: 'Listing conversations',
  summariseConversation: 'Summarising conversation',
  summariseConversationsThisWeek: 'Summarising the week',
  draftReply: 'Drafting reply',
  sendReply: 'Sending reply',
  confirmEscalateToHuman: 'Asking to escalate',
  executeEscalateToHuman: 'Escalating',
  confirmAssignConversation: 'Asking to assign',
  executeAssignConversation: 'Assigning',
  // Org defaults
  setOrgDefault: 'Updating default',
  // Messaging campaigns (bulk email/SMS/WhatsApp — keys are bare actions of
  // the canonical `campaigns_*` names; note `campaigns_segments_list` also
  // normalises to `list`, so that label covers both list tools)
  list: 'Listing campaigns',
  checkChannels: 'Checking channels',
  previewAudience: 'Previewing audience',
  createSegment: 'Creating audience segment',
  create: 'Creating campaign',
  setMessage: 'Writing campaign message',
  listWhatsappTemplates: 'Listing WhatsApp templates',
  showCampaignPreview: 'Preparing campaign preview',
  launch: 'Launching campaign',
};

const TITLE_CASE_RE = /([A-Z])/g;

/**
 * Convert a raw tool name into a friendly label.
 *
 * - First tries the {@link FRIENDLY_TOOL_LABELS} override (so "createCampaign"
 *   becomes "Creating campaign", matching the backend's status pill).
 * - Falls back to a generic transform that strips any `feature_` prefixes
 *   (so "meta_ads_createCampaign" matches "createCampaign") and converts
 *   camelCase to a title-case sentence.
 *
 * The fallback is intentionally simple: when a new tool ships, it shows up
 * with a passable label until someone adds it to FRIENDLY_TOOL_LABELS.
 */
export function toolNameToLabel(name: string): string {
  if (!name) return name;

  // The controller's alias map registers both the canonical name
  // (`meta_ads_createCampaign`) and the bare action (`createCampaign`).
  // Either form may reach the frontend depending on the wire path, so the
  // bare action is the canonical key for friendly labels.
  const bareAction = name.includes('_')
    ? (name.split('_').pop() ?? name)
    : name;
  if (FRIENDLY_TOOL_LABELS[bareAction]) return FRIENDLY_TOOL_LABELS[bareAction];
  if (FRIENDLY_TOOL_LABELS[name]) return FRIENDLY_TOOL_LABELS[name];

  // Generic transform on the bare action — never on the prefixed form,
  // which produces ugly mangled output like "Meta_load Skill".
  return (
    bareAction.charAt(0).toUpperCase() +
    bareAction.slice(1).replace(TITLE_CASE_RE, ' $1')
  ).trim();
}

/**
 * Does this tool part have anything to show?
 *
 * A CARD ANSWERS FOR ITSELF. The tool says which card it wants via
 * `presentation.type`, so a tool that emits one is visible — there is no list
 * to be on.
 *
 * ONE DEFINITION, because there were three. `tool-renderer` was moved off tool
 * names, but visibility was not, so `executeLaunchAd` emitted a perfectly good
 * confirmation envelope and was hidden before the renderer ever saw it — and
 * the two copies of this rule meant fixing it in one chat left the other chat
 * still broken. "Confirm on the card above", said over nothing, three times.
 */
export function isToolPartVisible(
  tp: ToolPartData,
  isAssistant: boolean
): boolean {
  if (!isAssistant) return false;
  const card = (tp.output as { presentation?: { type?: string } } | undefined)
    ?.presentation;
  // `none` is a tool saying it has nothing worth showing — a decision, not an
  // omission, so it must not fall through to the name list.
  if (card?.type) return card.type !== 'none';
  const name = getToolName(tp);
  if (RICH_TOOL_NAMES.has(name)) return true;
  if (!SILENT_TOOLS.has(name)) return tp.state !== 'output-available';
  if (tp.state === 'output-error') return true;
  return false;
}
