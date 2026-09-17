export {
  AskClaireButton,
  type AskClaireButtonProps,
} from './components/ask-claire-button';
export {
  AskClaireFooter,
  type AskClaireFooterProps,
} from './components/ask-claire-footer';
export {
  buildClairePrefillSearch,
  CLAIRE_PREFILL_ENTITY_TYPES,
  CLAIRE_PREFILL_PROMPT_MAX_LENGTH,
  isClairePrefillEntityType,
  type ClairePrefillEntityType,
  type ClairePrefillOptions,
} from './lib/build-claire-prefill-url';

// --- CA-1 foundation: types, api hooks, lib utilities ---

export type {
  ChatMessage,
  ChatRequestBody,
  ConversationSummary,
  ConversationWithMessages,
  StoredMessage,
  CreateConversationBody,
  SessionResponse,
} from './types';

export * from './api';

export { convertStoredToUIMessages } from './lib/convert-messages';
export {
  useClaireMood,
  deriveBaseMood,
  analyzeAssistantSignals,
  type ChatStatus,
  type ClaireMood,
  type DeriveBaseMoodInput,
  type UseClaireMoodOptions,
} from './lib/use-claire-mood';
export {
  asToolPart,
  getToolName,
  toolNameToLabel,
  CLIENT_TOOLS,
  RICH_TOOL_NAMES,
  SILENT_TOOLS,
  HIDDEN_FROM_TRACE_TOOLS,
  CONFIRMATION_TOOLS,
  isToolPartVisible,
  type ToolPartData,
} from './lib/tool-parts';

// --- CA-3 component exports: memories + usage settings ---

export {
  DailyTrendChart,
  MonthlyTrendChart,
  type DailyTrendChartProps,
  type MonthlyTrendChartProps,
  TopToolsList,
  type TopToolsListProps,
  MemoriesList,
  MemoryRow,
  type MemoryRowProps,
  MemoryEditDialog,
  type MemoryEditDialogProps,
  WhatsappPairingCard,
} from './components';
