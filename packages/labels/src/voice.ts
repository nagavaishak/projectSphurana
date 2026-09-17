/**
 * Voice enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Voice call status labels
export const voiceCallStatusLabels = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
} as const;

export const voiceCallStatusValues = Object.keys(voiceCallStatusLabels) as [
  keyof typeof voiceCallStatusLabels,
  ...(keyof typeof voiceCallStatusLabels)[],
];

export type VoiceCallStatus = keyof typeof voiceCallStatusLabels;

// Voice call outcome labels
export const voiceCallOutcomeLabels = {
  booked: 'Booked',
  callback_scheduled: 'Callback Scheduled',
  interested: 'Interested',
  not_interested: 'Not Interested',
  no_answer: 'No Answer',
  error: 'Error',
  unknown: 'Unknown',
} as const;

export const voiceCallOutcomeValues = Object.keys(voiceCallOutcomeLabels) as [
  keyof typeof voiceCallOutcomeLabels,
  ...(keyof typeof voiceCallOutcomeLabels)[],
];

export type VoiceCallOutcome = keyof typeof voiceCallOutcomeLabels;

// Voice sentiment labels
export const voiceSentimentLabels = {
  Positive: 'Positive',
  Negative: 'Negative',
  Neutral: 'Neutral',
  Unknown: 'Unknown',
} as const;

export const voiceSentimentValues = Object.keys(voiceSentimentLabels) as [
  keyof typeof voiceSentimentLabels,
  ...(keyof typeof voiceSentimentLabels)[],
];

export type VoiceSentiment = keyof typeof voiceSentimentLabels;
