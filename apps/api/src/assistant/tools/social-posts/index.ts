/**
 * Factory-shaped social posts tools.
 *
 * Replaces the legacy `createContentTools()` function in `content-tools.ts`
 * which used in-memory confirmation tokens, closures, and no telemetry.
 *
 * Key improvements over the legacy pattern:
 * - DB-persisted confirmation tokens (destructive tools)
 * - Sentry/PostHog telemetry via the factory wrapper
 * - Hard-blocked post content via `summarizeForConfirmation`
 * - Zod input validation with proper error messages
 * - `confirmSchedulePost` + `executeSchedulePost` merged into single
 *   `schedulePost` tool; `confirmPublishNow` + `executePublishNow` merged
 *   into single `publishPostNow` tool
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { createSocialPostDraftTool } from './create-social-post-draft.tool.js';
import { deleteSocialPostDraftTool } from './delete-social-post-draft.tool.js';
import { generatePostCaptionTool } from './generate-post-caption.tool.js';
import { listRecentPostsTool } from './list-recent-posts.tool.js';
import { publishPostNowTool } from './publish-post-now.tool.js';
import { schedulePostTool } from './schedule-post.tool.js';
import { suggestPostingTimeTool } from './suggest-posting-time.tool.js';
import { updateSocialPostDraftTool } from './update-social-post-draft.tool.js';

export const socialPostsTools: ToolDefinition[] = [
  listRecentPostsTool,
  generatePostCaptionTool,
  suggestPostingTimeTool,
  createSocialPostDraftTool,
  updateSocialPostDraftTool,
  deleteSocialPostDraftTool,
  schedulePostTool,
  publishPostNowTool,
];

export {
  createSocialPostDraftTool,
  deleteSocialPostDraftTool,
  generatePostCaptionTool,
  listRecentPostsTool,
  publishPostNowTool,
  schedulePostTool,
  suggestPostingTimeTool,
  updateSocialPostDraftTool,
};
