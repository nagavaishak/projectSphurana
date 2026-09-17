/**
 * The microsite agent: tools, guardrails, turn context and the turn lifecycle.
 *
 * Everything here is transport-free. The API layer
 * (apps/api/src/microsites/agent) adapts these tools into the Claire tool-loop
 * shape and maps the turn onto SSE; nothing in this folder knows either exists.
 */

export {
  DEFAULT_HISTORY_TURNS,
  buildMicrositeTurnContext,
  renderBlockCatalogue,
  type MicrositeTurnContext,
} from './build-turn-context.js';
export {
  appendMessage,
  loadRecentMessages,
  loadTranscript,
  resolveConversation,
  type MicrositeTranscriptMessage,
} from './conversation.js';
export { defineMicrositeTool } from './define-tool.js';
export {
  EMPTY_MICROSITE_DIFF,
  computeMicrositeDiff,
  describeDiff,
  isEmptyDiff,
  type MicrositeDiffEntry,
  type MicrositeTurnDiff,
} from './diff.js';
export {
  blockPrecis,
  outlineDocument,
  outlinePage,
  renderOutline,
  type BlockOutline,
  type PageOutline,
} from './document-summary.js';
export {
  loadDraft,
  requireBlock,
  requirePage,
  type DraftDocument,
} from './draft-writer.js';
export {
  MAX_MICROSITE_TOOL_CALLS,
  MAX_MICROSITE_TOOL_OUTPUT_BYTES,
  chargeToolCall,
  chargeToolOutput,
  confirmationKey,
  conversionBlockRefusal,
  createTurnBudget,
  isProtectedConversionBlock,
  type MicrositeTurnBudget,
} from './guardrails.js';
export { applyPropsPatch, patchedKeys } from './patch.js';
export {
  MICROSITE_AGENT_TOOLS,
  MICROSITE_AGENT_TOOL_NAMES,
  micrositeToolByName,
} from './tools/index.js';
export {
  beginMicrositeTurn,
  completeMicrositeTurn,
  type BeganMicrositeTurn,
  type CompletedMicrositeTurn,
} from './turn.js';
export {
  applyManualBlockEdit,
  getOrganizationWorkspace,
  micrositePreviewUrl,
  type ManualEditInput,
  type ManualEditOutput,
  type MicrositeWorkspace,
} from './workspace.js';
export type {
  MicrositeAgentSession,
  MicrositeAgentTool,
  MicrositeToolContext,
  MicrositeToolOutput,
} from './types.js';
