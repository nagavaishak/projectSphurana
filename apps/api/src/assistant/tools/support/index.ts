/**
 * Support tools — hand-off to a live Borradh agent via Intercom.
 *
 * Non-destructive: the actual conversation continues inside the Intercom
 * messenger; this tool's only side effect is flipping the Claire
 * conversation to `escalated` and seeding a new Intercom thread.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { requestSupportChatTool } from './request-support-chat.tool.js';

export const supportTools: ToolDefinition[] = [requestSupportChatTool];

export { requestSupportChatTool };
