/**
 * Scheduling enums (time off, wages) - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Time off type labels
export const timeOffTypeLabels = {
  annual_leave: 'Annual Leave',
  sick_leave: 'Sick Leave',
  training: 'Training',
  other: 'Other',
} as const;

export const timeOffTypeValues = Object.keys(timeOffTypeLabels) as [
  keyof typeof timeOffTypeLabels,
  ...(keyof typeof timeOffTypeLabels)[],
];

export type TimeOffType = keyof typeof timeOffTypeLabels;

// Employment type labels (practitioner work details)
export const employmentTypeLabels = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
  self_employed: 'Self-employed',
  intern: 'Intern',
} as const;

export const employmentTypeValues = Object.keys(employmentTypeLabels) as [
  keyof typeof employmentTypeLabels,
  ...(keyof typeof employmentTypeLabels)[],
];

export type EmploymentType = keyof typeof employmentTypeLabels;

// Wage compensation type labels
export const wageCompensationTypeLabels = {
  none: 'No Compensation',
  hourly: 'Hourly Rate',
} as const;

export const wageCompensationTypeValues = Object.keys(
  wageCompensationTypeLabels
) as [
  keyof typeof wageCompensationTypeLabels,
  ...(keyof typeof wageCompensationTypeLabels)[],
];

export type WageCompensationType = keyof typeof wageCompensationTypeLabels;

// Wage regular-hours-per labels
export const wageRegularHoursPerLabels = {
  day: 'Per Day',
  week: 'Per Week',
} as const;

export const wageRegularHoursPerValues = Object.keys(
  wageRegularHoursPerLabels
) as [
  keyof typeof wageRegularHoursPerLabels,
  ...(keyof typeof wageRegularHoursPerLabels)[],
];

export type WageRegularHoursPer = keyof typeof wageRegularHoursPerLabels;

// Wage overtime type labels
export const wageOvertimeTypeLabels = {
  multiplier: 'Overtime Multiplier',
  hourly_rate: 'Overtime Hourly Rate',
} as const;

export const wageOvertimeTypeValues = Object.keys(wageOvertimeTypeLabels) as [
  keyof typeof wageOvertimeTypeLabels,
  ...(keyof typeof wageOvertimeTypeLabels)[],
];

export type WageOvertimeType = keyof typeof wageOvertimeTypeLabels;

// Wage automation setting labels
export const wageAutomationSettingLabels = {
  workspace_default: 'Workspace Default',
  enabled: 'Enabled',
  disabled: 'Disabled',
} as const;

export const wageAutomationSettingValues = Object.keys(
  wageAutomationSettingLabels
) as [
  keyof typeof wageAutomationSettingLabels,
  ...(keyof typeof wageAutomationSettingLabels)[],
];

export type WageAutomationSetting = keyof typeof wageAutomationSettingLabels;
