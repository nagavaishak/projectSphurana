/**
 * Lead types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity and enum types
export type {
  Lead,
  LeadListItem,
  LeadDetail,
  SourceLeadForm,
  LeadStatus,
  LeadSource,
  LeadStats,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateLeadInput,
  UpdateLeadInput,
  ListLeadsFilters,
} from '@borradh-workspace/api-client/types';

// Response types
export type { ListLeadsResponse } from '@borradh-workspace/api-client/types';

// History types
export type {
  LeadActivity,
  LeadActivityType,
  LeadHistoryItem,
  LeadHistoryResponse,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  leadStatusLabels,
  leadStatusValues,
  leadSourceLabels,
  leadSourceValues,
  deduplicateByValues,
  onDuplicateValues,
} from '@borradh-workspace/api-client/types';

// Import/Export types
export type {
  ImportLeadsInput,
  ImportLeadsResponse,
  ImportError,
  ExportLeadsFilters,
  DeduplicateBy,
  OnDuplicate,
} from '@borradh-workspace/api-client/types';

// Sequence types (for history display)
export type {
  LeadHistoryExecution,
  SequenceExecutionStatus,
  SequenceStepType,
} from '@borradh-workspace/api-client/types';
