/**
 * @borradh-workspace/api-client - Assistant API Types
 *
 * Types for the AI assistant API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  AssistantMessageRole,
  AssistantConversation as BackendAssistantConversation,
  AssistantMessage as BackendAssistantMessage,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  assistantMessageRoleLabels,
  assistantMessageRoleValues,
  knowledgeEntryTypeLabels,
  knowledgeEntryTypeValues,
  knowledgeSourceLabels,
  knowledgeSourceValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateConversationInput as BackendCreateConversationInput,
  UpdateConversationInput as BackendUpdateConversationInput,
} from '@borradh-workspace/features/assistant';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { AssistantMessageRole };

// Re-export labels and values for frontend use
export {
  assistantMessageRoleLabels,
  assistantMessageRoleValues,
  knowledgeEntryTypeLabels,
  knowledgeEntryTypeValues,
  knowledgeSourceLabels,
  knowledgeSourceValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses
// ============================================================================

export type AssistantConversation = Serialize<BackendAssistantConversation>;

export type AssistantMessage = Serialize<BackendAssistantMessage>;

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type CreateConversationInput = Omit<
  BackendCreateConversationInput,
  'organizationId' | 'userId'
>;

export type UpdateConversationInput = Omit<
  BackendUpdateConversationInput,
  'organizationId' | 'userId'
>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface AssistantConversationWithMessages
  extends AssistantConversation {
  messages: AssistantMessage[];
}
