/**
 * Sequence enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Sequence step type labels
export const sequenceStepTypeLabels = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  voice_call: 'Voice Call',
  wait: 'Wait',
  condition: 'Condition',
  webhook: 'Webhook',
} as const;

export const sequenceStepTypeValues = Object.keys(sequenceStepTypeLabels) as [
  keyof typeof sequenceStepTypeLabels,
  ...(keyof typeof sequenceStepTypeLabels)[],
];

export type SequenceStepType = keyof typeof sequenceStepTypeLabels;

// Sequence version change type labels
export const sequenceVersionChangeTypeLabels = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  restored: 'Restored',
} as const;

export const sequenceVersionChangeTypeValues = Object.keys(
  sequenceVersionChangeTypeLabels
) as [
  keyof typeof sequenceVersionChangeTypeLabels,
  ...(keyof typeof sequenceVersionChangeTypeLabels)[],
];

export type SequenceVersionChangeType =
  keyof typeof sequenceVersionChangeTypeLabels;

// Sequence execution status labels
export const sequenceExecutionStatusLabels = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
} as const;

export const sequenceExecutionStatusValues = Object.keys(
  sequenceExecutionStatusLabels
) as [
  keyof typeof sequenceExecutionStatusLabels,
  ...(keyof typeof sequenceExecutionStatusLabels)[],
];

export type SequenceExecutionStatus =
  keyof typeof sequenceExecutionStatusLabels;
