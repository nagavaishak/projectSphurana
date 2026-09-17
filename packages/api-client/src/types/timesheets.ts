/**
 * @borradh-workspace/api-client - Timesheets API Types
 *
 * Types for the time-entries API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  TimeEntry as BackendTimeEntry,
  TimeEntryBreak as BackendTimeEntryBreak,
  TimeEntrySource,
  TimeEntryStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  timeEntrySourceLabels,
  timeEntrySourceValues,
  timeEntryStatusLabels,
  timeEntryStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  ClockInInput as BackendClockInInput,
  ClockOutInput as BackendClockOutInput,
  ListTimeEntriesInput as BackendListTimeEntriesInput,
  UpdateTimeEntryInput as BackendUpdateTimeEntryInput,
} from '@borradh-workspace/features/timesheets';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { TimeEntrySource, TimeEntryStatus };
export {
  timeEntrySourceLabels,
  timeEntrySourceValues,
  timeEntryStatusLabels,
  timeEntryStatusValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type TimeEntry = Serialize<BackendTimeEntry>;
export type TimeEntryBreak = Serialize<BackendTimeEntryBreak>;

export interface TimeEntryWithBreaks extends TimeEntry {
  breaks: TimeEntryBreak[];
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for clocking a practitioner in (POST /time-entries/clock-in)
 */
export type ClockInInput = Omit<
  BackendClockInInput,
  'organizationId' | 'requestingUserId' | 'canManageOthers'
>;

/**
 * Input for clocking out (POST /time-entries/:id/clock-out)
 */
export type ClockOutInput = Omit<
  BackendClockOutInput,
  'organizationId' | 'timeEntryId' | 'requestingUserId' | 'canManageOthers'
>;

/**
 * Input for the break toggle endpoint (POST /time-entries/:id/breaks)
 */
export interface AddBreakInput {
  type: 'start' | 'end';
  at?: string | Date;
}

/**
 * Input for manual time-entry edits (PUT /time-entries/:id)
 */
export type UpdateTimeEntryInput = Omit<
  BackendUpdateTimeEntryInput,
  'organizationId' | 'timeEntryId'
>;

/**
 * Parameters for listing time entries (GET /time-entries)
 */
export type ListTimeEntriesInput = Omit<
  BackendListTimeEntriesInput,
  'organizationId'
>;
