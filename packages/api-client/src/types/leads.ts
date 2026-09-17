/**
 * @borradh-workspace/api-client - Lead API Types
 *
 * Types derived from backend - following type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  ConsentSource,
  DeduplicateBy,
  LeadSource,
  LeadStatus,
  OnDuplicate,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  consentSourceLabels,
  consentSourceValues,
  deduplicateByValues,
  leadSourceLabels,
  leadSourceValues,
  leadStatusLabel,
  leadStatusLabels,
  leadStatusValues,
  normalizeLeadStage,
  onDuplicateValues,
  pipelineLeadStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend types from features (type-only - safe for browser bundles)
import type {
  Lead as BackendLead,
  LeadDetail as BackendLeadDetail,
  LeadListItem as BackendLeadListItem,
  SourceLeadForm as BackendSourceLeadForm,
} from '@borradh-workspace/features/leads';
import type {
  CreateLeadInput as BackendCreateLeadInput,
  ExportLeadsInput as BackendExportLeadsInput,
  ImportLeadsCsvInput as BackendImportLeadsCsvInput,
  ImportLeadsInput as BackendImportLeadsInput,
  ListLeadsInput as BackendListLeadsInput,
  UpdateLeadInput as BackendUpdateLeadInput,
} from '@borradh-workspace/features/leads';

// Import utility types
import type { Serialize } from './serialization.js';

// =============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// =============================================================================

/**
 * Lead status type - re-exported from database
 */
export type { LeadStatus };

/**
 * Lead source type - re-exported from database
 */
export type { LeadSource };

/**
 * Consent source type - re-exported from database
 */
export type { ConsentSource };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  leadStatusLabels,
  leadStatusValues,
  pipelineLeadStatusValues,
  leadStatusLabel,
  normalizeLeadStage,
  leadSourceLabels,
  leadSourceValues,
  consentSourceLabels,
  consentSourceValues,
};

// =============================================================================
// ENTITY TYPES - Serialized from backend
// =============================================================================

/**
 * Lead entity type (API response - dates serialized to ISO strings)
 */
export type Lead = Serialize<BackendLead>;

/**
 * A lead as the list endpoint returns it — {@link Lead} plus the server-derived
 * pipeline `stage`. Stage is computed, not stored, so it exists only here.
 */
export type LeadListItem = Serialize<BackendLeadListItem>;

/**
 * The lead form a lead originated from (only for `meta_lead_form` leads).
 */
export type SourceLeadForm = Serialize<BackendSourceLeadForm>;

/**
 * Lead detail entity (single-lead API response). Extends {@link Lead} with the
 * originating lead form, resolved server-side for `meta_lead_form` leads.
 */
export type LeadDetail = Serialize<BackendLeadDetail>;

// =============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// =============================================================================

/**
 * Input for creating a new lead
 * Omits organizationId (added by controller from session)
 * Uses Partial for status/source since they have server-side defaults
 */
export type CreateLeadInput = Omit<
  BackendCreateLeadInput,
  'organizationId' | 'status' | 'source'
> &
  Partial<Pick<BackendCreateLeadInput, 'status' | 'source'>>;

/**
 * Input for updating a lead
 * Omits id and organizationId (id from route param, orgId from session)
 */
export type UpdateLeadInput = Omit<
  BackendUpdateLeadInput,
  'id' | 'organizationId'
>;

/**
 * Filters for listing leads
 * Omits organizationId (added by controller from session)
 * Uses Partial because limit/offset have server-side defaults
 */
export type ListLeadsFilters = Partial<
  Omit<BackendListLeadsInput, 'organizationId'>
>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Response for listing leads
 */
export interface ListLeadsResponse {
  items: LeadListItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Lead stats for analytics
 */
export interface LeadStats {
  totalLeads: number;
  newLeads: number;
  contactedLeads: number;
  bookedLeads: number;
  lostLeads: number;
  conversionRate: number;
}

// =============================================================================
// HISTORY TYPES - For lead activity timeline
// =============================================================================

// Re-export sequence types for convenience
export type {
  SequenceExecutionStatus,
  SequenceStepType,
} from './sequences.js';

/**
 * Execution data for lead history display.
 * This is a specialized shape for the history timeline, different from the
 * sequences list execution type.
 */
export interface LeadHistoryExecution {
  id: string;
  leadId: string;
  sequenceId: string;
  sequenceName?: string;
  stepId: string;
  stepType?:
    | 'email'
    | 'sms'
    | 'whatsapp'
    | 'voice_call'
    | 'wait'
    | 'condition'
    | 'webhook';
  stepConfig?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
  result?: {
    messageId?: string;
    delivered?: boolean;
    opened?: boolean;
    clicked?: boolean;
    replied?: boolean;
    callDuration?: number;
    callOutcome?: string;
    error?: string;
  } | null;
  scheduledAt?: string | null;
  executedAt?: string | null;
  /** Raw DB column, unconverted — can be `null` for a non-failed execution (ENG-843). */
  errorMessage?: string | null;
  createdAt: string;
}

export type LeadActivityType =
  | 'lead_created'
  | 'status_changed'
  | 'assigned_to_sequence'
  | 'removed_from_sequence'
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'email_replied'
  | 'sms_sent'
  | 'sms_delivered'
  | 'whatsapp_sent'
  | 'whatsapp_delivered'
  | 'whatsapp_read'
  | 'message_received'
  | 'message_sent'
  | 'call_made'
  | 'call_answered'
  | 'call_completed'
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_completed'
  | 'deposit_paid'
  | 'note_added'
  | 'tag_added'
  | 'tag_removed';

export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  /** Raw DB column, unconverted — `null` for system-generated activities with no note (ENG-843). */
  description?: string | null;
  metadata?: {
    previousValue?: string;
    newValue?: string;
    sequenceId?: string;
    sequenceName?: string;
    appointmentId?: string;
    appointmentDate?: string;
    messageContent?: string;
    callDuration?: number;
    tagName?: string;
    amountCents?: number;
    currency?: string;
  };
  /** No actor for system-generated activities — absent OR raw `null` (ENG-843). */
  performedById?: string | null;
  performedByName?: string | null;
  createdAt: string;
}

export interface LeadHistoryItem {
  id: string;
  type: 'execution' | 'activity';
  timestamp: string;
  execution?: LeadHistoryExecution;
  activity?: LeadActivity;
}

export interface LeadHistoryResponse {
  items: LeadHistoryItem[];
  total: number;
}

// =============================================================================
// IMPORT/EXPORT TYPES
// =============================================================================

/**
 * Input for importing leads in bulk.
 * Omits organizationId (added by controller from session).
 */
export type ImportLeadsInput = Omit<BackendImportLeadsInput, 'organizationId'>;

/**
 * Filters for exporting leads.
 * Omits organizationId (added by controller from session).
 */
export type ExportLeadsFilters = Omit<
  BackendExportLeadsInput,
  'organizationId'
>;

/**
 * Single row error from import
 */
export interface ImportError {
  row: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Result of a lead import operation
 */
export interface ImportLeadsResponse {
  imported: number;
  skipped: number;
  updated: number;
  errors: ImportError[];
}

/**
 * Spreadsheet import: .csv text or a base64 .csv/.xlsx file, columns
 * auto-identified and imported (POST /leads/import-csv)
 */
export type ImportLeadsCsvInput = Omit<
  BackendImportLeadsCsvInput,
  'organizationId'
>;

export interface ImportLeadsCsvResponse extends ImportLeadsResponse {
  rowsInFile: number;
  cleanedRows: number;
  /** Data rows dropped for having no name and no contact detail. */
  skippedRows?: number;
  /** Header → lead-field mapping the import used. */
  columnMapping?: Record<string, string>;
  /** @deprecated always 0 since the deterministic parser. */
  failedChunks: number;
}

/**
 * Deduplication strategy options
 */
export type { DeduplicateBy };
export { deduplicateByValues };

/**
 * Duplicate handling strategy options
 */
export type { OnDuplicate };
export { onDuplicateValues };
