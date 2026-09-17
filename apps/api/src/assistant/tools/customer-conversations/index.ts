/**
 * Factory-shaped customer-conversations tools (W-C09-tools / Track C-09).
 *
 * Tool naming follows the factory convention `customer_conversations_<action>`.
 * Skill `toolNames` arrays in `manage-customer-chats.skill.ts` use the
 * unprefixed action names; the controller's alias map (W-C03-D) resolves
 * them to these factory tools at request time.
 *
 * Operator-facing — these tools help the operator stay on top of the inbox.
 * They do NOT modify Claire-Lead (the customer-facing chatbot at
 * `packages/features/src/chatbots/`); see `track-c09.md`.
 *
 * Two-tool destructive split (escalate, assign) mirrors W-C05 D-1 / W-C10
 * D-1 — the frontend `addToolOutput({ output: 'approved' | 'rejected' })`
 * pattern requires `confirm*` + `execute*` separation; the factory's
 * `destructive: true` auto-flow can't be re-invoked from that surface.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import {
  confirmAssignConversationTool,
  executeAssignConversationTool,
} from './assign-conversation.tool.js';
import { draftReplyTool } from './draft-reply.tool.js';
import {
  confirmEscalateToHumanTool,
  executeEscalateToHumanTool,
} from './escalate-to-human.tool.js';
import { listOpenConversationsTool } from './list-open-conversations.tool.js';
import { sendReplyTool } from './send-reply.tool.js';
import { summariseConversationTool } from './summarise-conversation.tool.js';
import { summariseConversationsThisWeekTool } from './summarise-conversations-this-week.tool.js';

export const customerConversationsTools: ToolDefinition[] = [
  listOpenConversationsTool,
  summariseConversationTool,
  summariseConversationsThisWeekTool,
  draftReplyTool,
  sendReplyTool,
  confirmEscalateToHumanTool,
  executeEscalateToHumanTool,
  confirmAssignConversationTool,
  executeAssignConversationTool,
];

export {
  confirmAssignConversationTool,
  confirmEscalateToHumanTool,
  draftReplyTool,
  executeAssignConversationTool,
  executeEscalateToHumanTool,
  listOpenConversationsTool,
  sendReplyTool,
  summariseConversationTool,
  summariseConversationsThisWeekTool,
};
