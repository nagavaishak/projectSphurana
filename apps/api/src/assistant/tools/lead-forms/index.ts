/**
 * Factory-shaped lead-form tools — let Claire build, preview, edit and list
 * Meta lead forms (instant forms) and wire the country-driven nurturing
 * follow-up channel onto them.
 *
 * Tool naming follows the factory convention `lead_forms_<action>`; skill
 * `toolNames` arrays use the unprefixed action names (`createLeadForm`, …),
 * resolved via the controller's alias map.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { createLeadFormTool } from './create-lead-form.tool.js';
import { listLeadFormsTool } from './list-lead-forms.tool.js';
import { previewLeadFormTool } from './preview-lead-form.tool.js';
import { updateLeadFormTool } from './update-lead-form.tool.js';

export const leadFormsTools: ToolDefinition[] = [
  listLeadFormsTool,
  previewLeadFormTool,
  createLeadFormTool,
  updateLeadFormTool,
];

export {
  createLeadFormTool,
  listLeadFormsTool,
  previewLeadFormTool,
  updateLeadFormTool,
};
