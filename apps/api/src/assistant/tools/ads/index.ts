/**
 * Factory-shaped Meta Ads tools (W-C05).
 *
 * Replaces the legacy `apps/api/src/assistant/tools/ad-tools.ts` (1,207L,
 * 13 tools). Each tool is now defined via `defineTool(...)` with proper
 * input validation, telemetry, and error sanitization. Destructive flows
 * (launch / pause / update budget) keep their two-tool split (confirm* +
 * execute*) — see `window-c05.md` D-1 for why we didn't collapse to a
 * single tool with the factory's destructive=true flow.
 *
 * `createCampaign` is non-destructive: campaigns are created PAUSED, so no
 * spend begins until the operator launches an ad attached to them. The
 * confirmation flow lives at `confirmLaunchAd` / `executeLaunchAd` where
 * money actually moves. See the Claire Creation Redesign (W2) for context.
 *
 * Tool name shape: `meta_ads_<action>` (e.g. `meta_ads_confirmLaunchAd`).
 * The controller's tool-catalogue alias map (W-C02-E) also registers the
 * bare action name (`confirmLaunchAd`) so skill `toolNames` arrays in
 * `packages/features/src/assistant/skills/*.skill.ts` resolve without
 * needing the feature prefix.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { checkMetaIntegrationTool } from './check-meta-integration.tool.js';
import { confirmLaunchAdTool } from './confirm-launch-ad.tool.js';
import { confirmPauseAdTool } from './confirm-pause-ad.tool.js';
import { confirmResumeAdTool } from './confirm-resume-ad.tool.js';
import { confirmUpdateBudgetTool } from './confirm-update-budget.tool.js';
import { createCampaignTool } from './create-campaign.tool.js';
import { createDraftAdTool } from './create-draft-ad.tool.js';
import { deleteDraftAdTool } from './delete-draft-ad.tool.js';
import { diagnoseCampaignTool } from './diagnose-campaign.tool.js';
import { duplicateAdTool } from './duplicate-ad.tool.js';
import { duplicateCampaignTool } from './duplicate-campaign.tool.js';
import { executeLaunchAdTool } from './execute-launch-ad.tool.js';
import { executePauseAdTool } from './execute-pause-ad.tool.js';
import { executeResumeAdTool } from './execute-resume-ad.tool.js';
import { executeUpdateBudgetTool } from './execute-update-budget.tool.js';
import { generateAdCopyTool } from './generate-ad-copy.tool.js';
import { getAdInsightsTool } from './get-ad-insights.tool.js';
import { getCampaignInsightsTool } from './get-campaign-insights.tool.js';
import { listCampaignsTool } from './list-campaigns.tool.js';
import { listLibraryImagesTool } from './list-library-images.tool.js';
import { listRecentAdsTool } from './list-recent-ads.tool.js';
import { previewCampaignTool } from './preview-campaign.tool.js';
import { replaceAdCreativeTool } from './replace-ad-creative.tool.js';
import { suggestAdOptimizationsTool } from './suggest-ad-optimizations.tool.js';
import { updateAdTool } from './update-ad.tool.js';
import { updateCampaignTool } from './update-campaign.tool.js';

export const adsTools: ToolDefinition[] = [
  checkMetaIntegrationTool,
  listCampaignsTool,
  createCampaignTool,
  listRecentAdsTool,
  getAdInsightsTool,
  getCampaignInsightsTool,
  generateAdCopyTool,
  suggestAdOptimizationsTool,
  diagnoseCampaignTool,
  previewCampaignTool,
  duplicateCampaignTool,
  duplicateAdTool,
  createDraftAdTool,
  deleteDraftAdTool,
  confirmLaunchAdTool,
  executeLaunchAdTool,
  confirmPauseAdTool,
  executePauseAdTool,
  confirmResumeAdTool,
  executeResumeAdTool,
  confirmUpdateBudgetTool,
  executeUpdateBudgetTool,
  updateAdTool,
  replaceAdCreativeTool,
  listLibraryImagesTool,
  updateCampaignTool,
];

export {
  checkMetaIntegrationTool,
  confirmLaunchAdTool,
  confirmPauseAdTool,
  confirmUpdateBudgetTool,
  createCampaignTool,
  createDraftAdTool,
  deleteDraftAdTool,
  diagnoseCampaignTool,
  duplicateAdTool,
  duplicateCampaignTool,
  executeLaunchAdTool,
  executePauseAdTool,
  executeUpdateBudgetTool,
  generateAdCopyTool,
  getAdInsightsTool,
  getCampaignInsightsTool,
  listCampaignsTool,
  listLibraryImagesTool,
  listRecentAdsTool,
  previewCampaignTool,
  replaceAdCreativeTool,
  suggestAdOptimizationsTool,
  updateAdTool,
  updateCampaignTool,
};
