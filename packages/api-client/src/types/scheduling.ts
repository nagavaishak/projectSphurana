/**
 * @borradh-workspace/api-client - Scheduling API Types
 *
 * Types for the blocked-time, time-off, shifts and wage-config endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  BlockedTime as BackendBlockedTime,
  BlockedTimeException as BackendBlockedTimeException,
  BlockedTimeType as BackendBlockedTimeType,
  PractitionerWageConfig as BackendPractitionerWageConfig,
  Shift as BackendShift,
  TimeOff as BackendTimeOff,
  TimeOffType,
  WageAutomationSetting,
  WageCompensationType,
  WageOvertimeType,
  WageRegularHoursPer,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  timeOffTypeLabels,
  timeOffTypeValues,
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
  wageOvertimeTypeLabels,
  wageOvertimeTypeValues,
  wageRegularHoursPerLabels,
  wageRegularHoursPerValues,
} from '@borradh-workspace/features/shared';

// Import backend service types from features
import type {
  BlockedTimeWithPractitioners as BackendBlockedTimeWithPractitioners,
  CreateBlockedTimeInput as BackendCreateBlockedTimeInput,
  CreateBlockedTimeTypeInput as BackendCreateBlockedTimeTypeInput,
  CreateTimeOffInput as BackendCreateTimeOffInput,
  ListBlockedTimeInput as BackendListBlockedTimeInput,
  ListShiftsInput as BackendListShiftsInput,
  ListTimeOffInput as BackendListTimeOffInput,
  ResolvedShiftDay as BackendResolvedShiftDay,
  SetShiftOverrideInput as BackendSetShiftOverrideInput,
  SetWeeklyShiftsInput as BackendSetWeeklyShiftsInput,
  UpdateBlockedTimeInput as BackendUpdateBlockedTimeInput,
  UpdateBlockedTimeTypeInput as BackendUpdateBlockedTimeTypeInput,
  UpdateTimeOffInput as BackendUpdateTimeOffInput,
  UpdateWageConfigInput as BackendUpdateWageConfigInput,
  BlockedTimeEditScope,
  ResolvedShiftInterval,
  ShiftInterval,
} from '@borradh-workspace/features/scheduling';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type {
  TimeOffType,
  WageCompensationType,
  WageRegularHoursPer,
  WageOvertimeType,
  WageAutomationSetting,
  BlockedTimeEditScope,
};
export {
  timeOffTypeLabels,
  timeOffTypeValues,
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
  wageRegularHoursPerLabels,
  wageRegularHoursPerValues,
  wageOvertimeTypeLabels,
  wageOvertimeTypeValues,
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

export type BlockedTimeType = Serialize<BackendBlockedTimeType>;
export type BlockedTime = Serialize<BackendBlockedTime>;
export type BlockedTimeException = Serialize<BackendBlockedTimeException>;
export type BlockedTimeWithPractitioners =
  Serialize<BackendBlockedTimeWithPractitioners>;
export type TimeOff = Serialize<BackendTimeOff>;
export type Shift = Serialize<BackendShift>;
export type ResolvedShiftDay = Serialize<BackendResolvedShiftDay>;
export type PractitionerWageConfig = Serialize<BackendPractitionerWageConfig>;
export type { ResolvedShiftInterval, ShiftInterval };

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

export type CreateBlockedTimeTypeInput = Omit<
  BackendCreateBlockedTimeTypeInput,
  'organizationId'
>;

export type UpdateBlockedTimeTypeInput = Omit<
  BackendUpdateBlockedTimeTypeInput,
  'id' | 'organizationId'
>;

export type ListBlockedTimeInput = Omit<
  BackendListBlockedTimeInput,
  'organizationId'
>;

export type CreateBlockedTimeInput = Omit<
  BackendCreateBlockedTimeInput,
  'organizationId' | 'createdById'
>;

/** `scope` travels as a query param on PUT /blocked-time/:id. */
export type UpdateBlockedTimeInput = Omit<
  BackendUpdateBlockedTimeInput,
  'id' | 'organizationId' | 'scope' | 'createdById'
>;

export type ListTimeOffInput = Omit<BackendListTimeOffInput, 'organizationId'>;

export type CreateTimeOffInput = Omit<
  BackendCreateTimeOffInput,
  'organizationId' | 'createdById'
>;

export type UpdateTimeOffInput = Omit<
  BackendUpdateTimeOffInput,
  'id' | 'organizationId'
>;

export type ListShiftsInput = Omit<BackendListShiftsInput, 'organizationId'>;

export type SetWeeklyShiftsInput = Omit<
  BackendSetWeeklyShiftsInput,
  'organizationId' | 'practitionerId'
>;

export type SetShiftOverrideInput = Omit<
  BackendSetShiftOverrideInput,
  'organizationId' | 'practitionerId'
>;

export type UpdateWageConfigInput = Omit<
  BackendUpdateWageConfigInput,
  'organizationId' | 'practitionerId'
>;
