/**
 * Factory-shaped chatbots tools (Claire reliability overhaul, Phase 8).
 *
 * Two tools, both destructive so the factory's confirmation flow gates every
 * write:
 *   - `chatbots_setEnabled`   — the per-channel chatbot kill switch (register
 *                               finding #65: an owner could not turn a
 *                               misbehaving customer chatbot off while it was
 *                               live on customers).
 *   - `chatbots_setDirective` — set or clear the customer chatbot's top-level
 *                               override (the CUSTOM DIRECTIVE block), the one
 *                               piece of the bot's prompt an owner controls.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { setChatbotDirectiveTool } from './set-directive.tool.js';
import { setChatbotEnabledTool } from './set-enabled.tool.js';

export const chatbotsTools: ToolDefinition[] = [
  setChatbotEnabledTool,
  setChatbotDirectiveTool,
];

export { setChatbotEnabledTool, setChatbotDirectiveTool };
