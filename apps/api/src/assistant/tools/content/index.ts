/**
 * Content tools — one vertical, addressed by the CONTENT ITEM.
 *
 * An owner asks to change "this post". Whether the thing behind it is a video
 * or a graphic, and which endpoint the change reaches, is our problem. Splitting
 * the tools by asset kind made it theirs, via Claire: she had to pick the kind
 * and the mechanism correctly before she could act, from a context line carrying
 * two ids, and a wrong pick returned a not-found that reads exactly like "this
 * post cannot be edited".
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { createContentTool } from './create-content.tool.js';
import { listMediaTool } from './list-media.tool.js';
import { patchContentTool } from './patch-content.tool.js';
import { renderVideoTool } from './render-video.tool.js';

export const contentTools: ToolDefinition[] = [
  createContentTool,
  listMediaTool,
  patchContentTool,
  // Separate from `patchContent` because confirmation is declared per TOOL:
  // a caption rewrite must not ask permission, and a render must.
  renderVideoTool,
];

export { createContentTool, listMediaTool, patchContentTool, renderVideoTool };
