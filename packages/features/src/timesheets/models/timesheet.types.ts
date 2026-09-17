import type {
  OrgDefaultsRow,
  PractitionerWageConfig,
  TimeEntry,
  TimeEntryBreak,
} from '@borradh-workspace/database';
import type {
  WageAutomationSetting,
  WageCompensationType,
  WageOvertimeType,
  WageRegularHoursPer,
} from '@borradh-workspace/labels';

/**
 * Time entry with its break rows (list endpoint response shape).
 */
export interface TimeEntryWithBreaks extends TimeEntry {
  breaks: TimeEntryBreak[];
}

// =============================================================================
// Contract-shaped inputs for the pure timesheet calculators.
//
// These are now sourced from the real scheduling domain — the enum unions come
// from `@borradh-workspace/labels` (the single source of truth, see
// `packages/labels/src/scheduling.ts`) and the config/defaults slices are
// `Pick<>`s of the drizzle-inferred rows (`practitioner_wage_config`,
// `org_defaults`). The calculators stay pure: they consume these narrow
// structural slices, which the real rows are directly assignable to.
// =============================================================================

/**
 * Per-practitioner automation setting — the `wage_automation_setting` pgEnum on
 * `practitioner_wage_config` (contract §1.1.8).
 */
export type ContractWageAutomationSetting = WageAutomationSetting;

/** Overtime type — the `wage_overtime_type` pgEnum (contract §1.1.8). */
export type ContractWageOvertimeType = WageOvertimeType;

/** Regular-hours period — the `wage_regular_hours_per` pgEnum (contract §1.1.8). */
export type ContractWageRegularHoursPer = WageRegularHoursPer;

/** Compensation type — the `wage_compensation_type` pgEnum (contract §1.1.8). */
export type ContractWageCompensationType = WageCompensationType;

/**
 * The wage/automation slice of `practitioner_wage_config` (contract §1.1.8)
 * consumed by the overtime calculator.
 */
export type ContractWageConfig = Pick<
  PractitionerWageConfig,
  | 'compensationType'
  | 'hourlyRateCents'
  | 'overtimeEnabled'
  | 'regularWorkHours'
  | 'regularWorkHoursPer'
  | 'overtimeType'
  | 'overtimeMultiplier'
  | 'overtimeHourlyRateCents'
>;

/**
 * The automation-flag slice of `practitioner_wage_config` (contract §1.1.8).
 */
export type ContractWageAutomationConfig = Pick<
  PractitionerWageConfig,
  'autoClockIn' | 'autoClockOut' | 'automatedBreaks'
>;

/**
 * The wage-automation slice of `org_defaults` (contract §1.1.8 additions).
 * Nullable columns; resolver default is `false`.
 */
export type ContractOrgWageDefaults = Pick<
  OrgDefaultsRow,
  'wageAutoClockIn' | 'wageAutoClockOut' | 'wageAutomatedBreaks'
>;

/**
 * A resolved shift window for a single practitioner on a single date —
 * the output of applying override semantics (contract §1.1.6) to `shift`
 * rows via the scheduling `resolveShiftDays` util, then converting
 * minutes-from-midnight to absolute instants.
 */
export interface ContractShiftWindow {
  start: Date;
  end: Date;
}

/**
 * A single expanded occurrence of a `blocked_time` row (contract §1.1.2), as
 * produced by the scheduling `expandBlockedTime` recurrence expansion.
 */
export interface ContractBlockedTimeOccurrence {
  start: Date;
  end: Date;
  paid: boolean;
}
