/**
 * Timesheet enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Time entry source labels
export const timeEntrySourceLabels = {
  manual: 'Manual',
  auto: 'Automatic',
} as const;

export const timeEntrySourceValues = Object.keys(timeEntrySourceLabels) as [
  keyof typeof timeEntrySourceLabels,
  ...(keyof typeof timeEntrySourceLabels)[],
];

export type TimeEntrySource = keyof typeof timeEntrySourceLabels;

// Time entry status labels
export const timeEntryStatusLabels = {
  open: 'Clocked In',
  completed: 'Completed',
  approved: 'Approved',
} as const;

export const timeEntryStatusValues = Object.keys(timeEntryStatusLabels) as [
  keyof typeof timeEntryStatusLabels,
  ...(keyof typeof timeEntryStatusLabels)[],
];

export type TimeEntryStatus = keyof typeof timeEntryStatusLabels;
