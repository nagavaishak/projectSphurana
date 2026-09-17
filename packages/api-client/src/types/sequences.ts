/**
 * @borradh-workspace/api-client - Sequence API Types
 *
 * Types for the sequences API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  SequenceExecutionStatus,
  SequenceStepType,
  SequenceVersionChangeType,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  sequenceExecutionStatusLabels,
  sequenceExecutionStatusValues,
  sequenceStepTypeLabels,
  sequenceStepTypeValues,
  sequenceVersionChangeTypeLabels,
  sequenceVersionChangeTypeValues,
} from '@borradh-workspace/features/shared';

// Import backend types from features
import type {
  CallbackInfo as BackendCallbackInfo,
  CreateSequenceInput as BackendCreateSequenceInput,
  ExecutionHistoryStep as BackendExecutionHistoryStep,
  LeadExecutionHistory as BackendLeadExecutionHistory,
  ListExecutionsInput as BackendListExecutionsInput,
  ListSequencesInput as BackendListSequencesInput,
  Sequence as BackendSequence,
  TestCallInput as BackendTestCallInput,
  TestEmailInput as BackendTestEmailInput,
  TestSmsInput as BackendTestSmsInput,
  UpdateSequenceInput as BackendUpdateSequenceInput,
  ExecutionWithDetails,
} from '@borradh-workspace/features/sequences';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Sequence step type - re-exported from database
 */
export type { SequenceStepType };

/**
 * Sequence version change type - re-exported from database
 */
export type { SequenceVersionChangeType };

/**
 * Sequence execution status type - re-exported from database
 */
export type { SequenceExecutionStatus };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  sequenceStepTypeLabels,
  sequenceStepTypeValues,
  sequenceVersionChangeTypeLabels,
  sequenceVersionChangeTypeValues,
  sequenceExecutionStatusLabels,
  sequenceExecutionStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Sequence entity type (API response - dates serialized to ISO strings)
 */
export type Sequence = Serialize<BackendSequence>;

/**
 * Execution with details (API response)
 */
export type SequenceExecution = Serialize<ExecutionWithDetails>;

// ============================================================================
// EDITOR TYPES - Used by sequence builder UI
// ============================================================================

/**
 * Editor node type (from sequence editor)
 */
export interface EditorNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/**
 * Editor edge type (from sequence editor)
 */
export interface EditorEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Global settings for the sequence (per-action-type shared config)
 */
export type SequenceGlobalSettings = Record<string, unknown>;

/**
 * Helper to get status string from isActive boolean
 */
export function getSequenceStatus(sequence: Sequence): 'active' | 'draft' {
  return sequence.isActive ? 'active' : 'draft';
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for creating a new sequence
 * Omits organizationId, createdById (added by controller from session)
 */
export type CreateSequenceInput = Omit<
  BackendCreateSequenceInput,
  'organizationId' | 'createdById'
>;

/**
 * Input for updating a sequence
 * Omits id, organizationId, userId (id from route param, others from session)
 */
export type UpdateSequenceInput = Omit<
  BackendUpdateSequenceInput,
  'id' | 'organizationId' | 'userId'
>;

/**
 * Parameters for listing sequences
 * Omits organizationId (added by controller from session)
 */
export type ListSequencesParams = Omit<
  BackendListSequencesInput,
  'organizationId'
>;

/**
 * Parameters for listing executions
 * Omits organizationId (added by controller from session)
 */
export type ListExecutionsParams = Omit<
  BackendListExecutionsInput,
  'organizationId'
>;

/**
 * Input for testing email action
 * Omits organizationId (added by controller from session)
 */
export type TestEmailInput = Omit<BackendTestEmailInput, 'organizationId'>;

/**
 * Input for testing SMS action
 * Omits organizationId (added by controller from session)
 */
export type TestSmsInput = Omit<BackendTestSmsInput, 'organizationId'>;

/**
 * Input for testing call action
 * Omits organizationId (added by controller from session)
 */
export type TestCallInput = Omit<BackendTestCallInput, 'organizationId'>;

/**
 * Response for listing sequences
 */
export interface ListSequencesResponse {
  sequences: Sequence[];
  total: number;
}

// API returns Sequence directly, not wrapped
export type CreateSequenceResponse = Sequence;
export type GetSequenceResponse = Sequence;
export type UpdateSequenceResponse = Sequence;
export type ActivateSequenceResponse = Sequence;

export interface DeleteSequenceResponse {
  success: boolean;
}

// ============================================================================
// VERSION HISTORY TYPES
// ============================================================================

export interface SequenceVersionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface SequenceVersion {
  id: string;
  sequenceId: string;
  version: number;
  nodes: unknown[];
  edges: unknown[];
  changeType: SequenceVersionChangeType;
  changeSummary: string | null;
  createdById: string;
  createdAt: string;
  createdBy: SequenceVersionUser;
}

export interface ListSequenceVersionsResponse {
  versions: SequenceVersion[];
  total: number;
}

export type RestoreSequenceVersionResponse = Sequence;

// ============================================================================
// EXECUTION RESPONSE TYPES
// ============================================================================

export interface ListExecutionsResponse {
  executions: SequenceExecution[];
  total: number;
}

// ============================================================================
// TEST ACTION RESPONSE TYPES
// ============================================================================

export interface TestEmailResponse {
  success: boolean;
  messageId?: string;
}

export interface TestSmsResponse {
  success: boolean;
  messageId?: string;
}

export interface TestCallResponse {
  success: boolean;
  callId?: string;
  message: string;
}

// ============================================================================
// EXECUTION HISTORY TYPES
// ============================================================================

export type LeadExecutionHistory = BackendLeadExecutionHistory;
export type ExecutionHistoryStep = BackendExecutionHistoryStep;
export type CallbackInfo = BackendCallbackInfo;
