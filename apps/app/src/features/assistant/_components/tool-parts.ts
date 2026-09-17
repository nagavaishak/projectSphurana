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

/**
 * Tools whose output is rendered as rich content but carries NO presentation
 * envelope yet.
 *
 * A tool that names its card is visible because it named one — see
 * `isToolPartVisible`. This list is the remainder: older `uiState` shapes that
 * say nothing about how they want to be shown. It had drifted into a second
 * dispatch table, listing three tools that no longer exist while omitting
 * `executeLaunchAd`, whose confirmation card was therefore hidden before the
 * renderer saw it. Shrink it; do not add to it.
 */
export const RICH_TOOL_NAMES = new Set([
  'createContent',
  'getVideoStatus',
  'generateTalkingHeadQR',
  'patchContent',
  'updateAd',
  'replaceAdCreative',
  'confirmLaunchAd',
  'confirmPauseAd',
  'confirmUpdateBudget',
]);

/** Server tools that execute silently (no visible UI while running) */
export const SILENT_TOOLS = new Set([
  'createContent',
  'generateVideoScript',
  'autoSelectClips',
  'listDraftClips',
  'autoSelectMusic',
  'updateDraftConfig',
  'executeVideoExport',
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
]);

/** Tool types that imply Claire is asking for a destructive confirmation. */
export const CONFIRMATION_TOOLS = new Set([
  'confirmLaunchAd',
  'confirmPauseAd',
  'confirmUpdateBudget',
]);

const TITLE_CASE_RE = /([A-Z])/g;

/** "executePauseAd" -> "Execute Pause Ad" */
export function toolNameToLabel(name: string): string {
  if (!name) return name;
  return (
    name.charAt(0).toUpperCase() + name.slice(1).replace(TITLE_CASE_RE, ' $1')
  ).trim();
}

// ONE DEFINITION, in `../lib/tool-parts`. This module is the component tree's
// view of the same helpers; re-exporting keeps a second copy from growing back.
export { isToolPartVisible } from '../lib/tool-parts';
