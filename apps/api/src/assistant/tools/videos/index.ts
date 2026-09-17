/**
 * Factory-shaped video tools (W-C10).
 *
 * Replaces the legacy `apps/api/src/assistant/tools/video-tools.ts` (579L,
 * 10 tools). Each tool is now defined via `defineTool(...)` with proper
 * input validation, telemetry, and error sanitization. The destructive
 * flow (queue → execute) keeps the two-tool split per W-C10 D-1 (mirrors
 * W-C05 D-1) — the frontend's AI SDK v5 `addToolOutput({ output })` pattern
 * doesn't support the factory's single-tool `destructive: true` re-invocation
 * flow. See `window-c10-port.md` for full reasoning.
 *
 * Tool name shape: `videos_<action>` (e.g. `videos_queueVideoExport`). The
 * controller's tool-catalogue alias map (W-C02-E) also registers the bare
 * action name (`queueVideoExport`) so:
 *   - skill `toolNames` arrays in `generate-video.skill.ts` resolve without
 *     the feature prefix;
 *   - the frontend `tool-renderer.tsx` (which keys off bare names like
 *     `queueVideoExport`, `getVideoStatus`, `generateTalkingHeadQR`,
 *     `listAvailableAssets`) keeps mounting the right rich-content
 *     renderers without a touch.
 *
 * `listRecentVideos` is NOT here — it lives at
 * `apps/api/src/assistant/tools/context/list-recent-videos.tool.ts` (factory
 * name `context_listRecentVideos`). Coordination check is in `track-c10.md`
 * + `window-c10-port.md`'s composer correction.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { autoSelectClipsTool } from './auto-select-clips.tool.js';
import { autoSelectMusicTool } from './auto-select-music.tool.js';
import { deleteDraftVideoTool } from './delete-draft-video.tool.js';
import { generateTalkingHeadQRTool } from './generate-talking-head-qr.tool.js';
import { generateVideoScriptTool } from './generate-video-script.tool.js';
import { getVideoStatusTool } from './get-video-status.tool.js';
import { listDraftClipsTool } from './list-draft-clips.tool.js';
import { useStockClipsTool } from './use-stock-clips.tool.js';

export const videosTools: ToolDefinition[] = [
  generateVideoScriptTool,
  listDraftClipsTool,
  useStockClipsTool,
  autoSelectClipsTool,
  autoSelectMusicTool,
  getVideoStatusTool,
  generateTalkingHeadQRTool,
  deleteDraftVideoTool,
];

export {
  autoSelectClipsTool,
  autoSelectMusicTool,
  deleteDraftVideoTool,
  generateTalkingHeadQRTool,
  generateVideoScriptTool,
  getVideoStatusTool,
  listDraftClipsTool,
  useStockClipsTool,
};
