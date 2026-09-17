/**
 * Factory-shaped messaging-campaigns tools (Phase 7).
 *
 * Tool naming follows the factory convention `campaigns_<action>`, producing
 * the canonical names `campaigns_list`, `campaigns_segments_list`,
 * `campaigns_create`, `campaigns_launch`. The `manage-messaging-campaigns`
 * skill references these canonical names directly (rather than the bare-action
 * aliases) to avoid colliding with the Meta-ads tools that already register
 * generic bare actions like `listCampaigns` / `createCampaign`.
 *
 * These reuse the existing campaign feature services via the NestJS
 * `/campaigns` HTTP endpoints (the same path every other factory tool uses):
 *   - `campaigns_list`          → GET  /campaigns          (listCampaigns)
 *   - `campaigns_segments_list` → GET  /campaigns/segments (listSegments)
 *   - `campaigns_create`        → POST /campaigns          (createCampaign)
 *   - `campaigns_launch`        → POST /campaigns/:id/launch (launchCampaign)
 *
 * `campaigns_launch` sends real messages, so it is `destructive: true` and
 * goes through the factory confirmation flow bound to the `launch_campaign`
 * confirmation action.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { checkChannelsTool } from './check-channels.tool.js';
import { createCampaignTool } from './create-campaign.tool.js';
import { createSegmentTool } from './create-segment.tool.js';
import { launchCampaignTool } from './launch-campaign.tool.js';
import { listCampaignsTool } from './list-campaigns.tool.js';
import { listSegmentsTool } from './list-segments.tool.js';
import { listWhatsappTemplatesTool } from './list-whatsapp-templates.tool.js';
import { previewAudienceTool } from './preview-audience.tool.js';
import { setCampaignMessageTool } from './set-campaign-message.tool.js';
import { showCampaignPreviewTool } from './show-campaign-preview.tool.js';

export const campaignsTools: ToolDefinition[] = [
  checkChannelsTool,
  listCampaignsTool,
  listSegmentsTool,
  createSegmentTool,
  createCampaignTool,
  setCampaignMessageTool,
  previewAudienceTool,
  listWhatsappTemplatesTool,
  showCampaignPreviewTool,
  launchCampaignTool,
];

export {
  checkChannelsTool,
  createCampaignTool,
  createSegmentTool,
  launchCampaignTool,
  listCampaignsTool,
  listSegmentsTool,
  listWhatsappTemplatesTool,
  previewAudienceTool,
  setCampaignMessageTool,
  showCampaignPreviewTool,
};
