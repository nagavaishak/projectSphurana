/**
 * THE registry. Thirteen tools, contract §2, in one array.
 *
 * Both entry points — the streaming controller and the headless/eval runner —
 * build their tool map from THIS list and nothing else. That is the structural
 * answer to the registration gotcha the contract calls out: there is no second
 * list to forget to update, and `microsite-tools.parity.spec.ts` in apps/api
 * asserts the two runners agree on the names.
 */

import type { MicrositeAgentTool } from '../types.js';
import { generateImageTool, searchOrgAssetsTool } from './asset-tools.js';
import {
  addBlockTool,
  deleteBlockTool,
  moveBlockTool,
  updateBlockTool,
} from './block-tools.js';
import { createPageTool, deletePageTool, updateSeoTool } from './page-tools.js';
import { listPagesTool, previewTool, readPageTool } from './read-tools.js';
import { updateThemeTool } from './theme-tools.js';

export const MICROSITE_AGENT_TOOLS: readonly MicrositeAgentTool[] = [
  listPagesTool,
  readPageTool,
  addBlockTool,
  updateBlockTool,
  moveBlockTool,
  deleteBlockTool,
  createPageTool,
  deletePageTool,
  updateThemeTool,
  updateSeoTool,
  searchOrgAssetsTool,
  generateImageTool,
  previewTool,
];

export const MICROSITE_AGENT_TOOL_NAMES: readonly string[] =
  MICROSITE_AGENT_TOOLS.map((tool) => tool.name);

export const micrositeToolByName = (
  name: string
): MicrositeAgentTool | undefined =>
  MICROSITE_AGENT_TOOLS.find((tool) => tool.name === name);

export {
  addBlockTool,
  createPageTool,
  deleteBlockTool,
  deletePageTool,
  generateImageTool,
  listPagesTool,
  moveBlockTool,
  previewTool,
  readPageTool,
  searchOrgAssetsTool,
  updateBlockTool,
  updateSeoTool,
  updateThemeTool,
};
