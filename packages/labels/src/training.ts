/**
 * Training enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Training category labels
export const trainingCategoryLabels = {
  'getting-started': 'Getting Started',
  'dashboard-guide': 'Dashboard Guide',
  'video-creation': 'Video Creation',
  'lead-management': 'Lead Management',
  sequences: 'Sequences',
  'best-practices': 'Best Practices',
  advanced: 'Advanced',
} as const;

export const trainingCategoryValues = Object.keys(trainingCategoryLabels) as [
  keyof typeof trainingCategoryLabels,
  ...(keyof typeof trainingCategoryLabels)[],
];

export type TrainingCategory = keyof typeof trainingCategoryLabels;
