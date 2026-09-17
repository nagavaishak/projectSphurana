/**
 * Factory-shaped org-defaults tools.
 *
 * Tool naming follows the factory convention `org_defaults_<action>`. Skill
 * `toolNames` arrays reference the bare action name (`setOrgDefault`); the
 * controller's alias map resolves them to these factory tools at request time.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { setOrgDefaultTool } from './set-org-default.tool.js';

export const orgDefaultsTools: ToolDefinition[] = [setOrgDefaultTool];

export { setOrgDefaultTool };
