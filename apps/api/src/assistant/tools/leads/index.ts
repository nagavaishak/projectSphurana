/**
 * Factory-shaped leads tools (W-C06 / Track C-06, Phase 2).
 *
 * Tool naming follows the factory convention `leads_<action>`. Skill
 * `toolNames` arrays in `manage-leads.skill.ts` use the unprefixed action
 * names; the controller's alias map (W-C03-D) resolves them to these
 * factory tools at request time.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { createLeadTool } from './create-lead.tool.js';
import { getLeadStatsTool } from './get-lead-stats.tool.js';
import { listLeadsTool } from './list-leads.tool.js';
import { searchLeadsTool } from './search-leads.tool.js';
import { summariseRecentLeadsTool } from './summarise-recent-leads.tool.js';
import { updateLeadTool } from './update-lead.tool.js';

export const leadsTools: ToolDefinition[] = [
  listLeadsTool,
  searchLeadsTool,
  getLeadStatsTool,
  summariseRecentLeadsTool,
  createLeadTool,
  updateLeadTool,
];

export {
  createLeadTool,
  getLeadStatsTool,
  listLeadsTool,
  searchLeadsTool,
  summariseRecentLeadsTool,
  updateLeadTool,
};
