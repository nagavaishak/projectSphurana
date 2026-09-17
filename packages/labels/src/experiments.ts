/**
 * Experiments enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Experiment status labels
export const experimentStatusLabels = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
} as const;

export const experimentStatusValues = Object.keys(experimentStatusLabels) as [
  keyof typeof experimentStatusLabels,
  ...(keyof typeof experimentStatusLabels)[],
];

export type ExperimentStatus = keyof typeof experimentStatusLabels;
