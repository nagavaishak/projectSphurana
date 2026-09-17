/**
 * @borradh-workspace/api-client - Lead Forms API Types
 *
 * Types for the lead forms API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  LeadForm as BackendLeadForm,
  LeadFormQuestion as BackendLeadFormQuestion,
  LeadFormFieldType,
  LeadFormFollowUpChannel,
  LeadFormStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  defaultLeadFormQuestions,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelLabels,
  leadFormFollowUpChannelValues,
  leadFormStatusLabels,
  leadFormStatusValues,
} from '@borradh-workspace/features/shared';

import type { LeadFormDefaultQuestion } from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateLeadFormInput as BackendCreateLeadFormInput,
  ListLeadFormsInput as BackendListLeadFormsInput,
  SyncLeadFormToMetaInput as BackendSyncLeadFormToMetaInput,
  UpdateLeadFormInput as BackendUpdateLeadFormInput,
} from '@borradh-workspace/features/lead-forms';

import type { Serialize } from './serialization.js';
import type { PaginatedResponse } from './shared.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type {
  LeadFormStatus,
  LeadFormFieldType,
  LeadFormFollowUpChannel,
  LeadFormDefaultQuestion,
};
export {
  leadFormStatusLabels,
  leadFormStatusValues,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelLabels,
  leadFormFollowUpChannelValues,
  defaultLeadFormQuestions,
};

// ============================================================================
// SHARED TYPES - Re-exported from database
// ============================================================================

/**
 * Single question in a lead form
 */
export type LeadFormQuestion = BackendLeadFormQuestion;

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Lead form entity type (API response - dates serialized to ISO strings)
 */
export type LeadForm = Serialize<BackendLeadForm>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List lead forms response
 */
export interface ListLeadFormsResponse extends PaginatedResponse<LeadForm> {}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for creating a lead form
 * Omits organizationId (added by controller from session)
 * syncToMeta has server default (false) so it's optional for API input
 */
export type CreateLeadFormInput = Omit<
  BackendCreateLeadFormInput,
  'organizationId' | 'syncToMeta'
> &
  Partial<Pick<BackendCreateLeadFormInput, 'syncToMeta'>>;

/**
 * Input for updating a lead form
 * Omits id, organizationId (id from route param, organizationId from session)
 * syncToMeta has server default (false) so it's optional for API input
 */
export type UpdateLeadFormInput = Omit<
  BackendUpdateLeadFormInput,
  'id' | 'organizationId' | 'syncToMeta'
> &
  Partial<Pick<BackendUpdateLeadFormInput, 'syncToMeta'>>;

/**
 * Parameters for listing lead forms
 * Omits organizationId (added by controller from session)
 */
export type ListLeadFormsParams = Omit<
  BackendListLeadFormsInput,
  'organizationId'
>;

/**
 * Input for syncing a lead form to Meta
 * Omits leadFormId (from route param)
 */
export type SyncLeadFormInput = Omit<
  BackendSyncLeadFormToMetaInput,
  'leadFormId'
>;
