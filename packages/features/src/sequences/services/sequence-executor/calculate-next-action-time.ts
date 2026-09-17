import type { BusinessHours } from '../../../shared/index.js';
import { getNextBusinessHoursTime } from '../../../shared/index.js';
import { parseDuration } from './parse-duration.js';
import type { SequenceStep } from './types.js';

/**
 * Calculate next action time based on step configuration
 * Applies business hours constraints for voice_call steps
 */
export function calculateNextActionTime(
  currentStep: SequenceStep,
  nextStep: SequenceStep,
  businessHours: BusinessHours | null
): Date {
  const config = nextStep.config;
  const now = new Date();

  // After a voice call, give the call time to complete before evaluating conditions
  if (currentStep.type === 'voice_call' && nextStep.type === 'condition') {
    return new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
  }

  // If next step is a wait step, use its duration
  if (nextStep.type === 'wait' && config.duration) {
    const duration = parseDuration(config.duration as string);
    let scheduledTime = new Date(now.getTime() + duration);

    // If the wait leads to a voice call AND we have business hours,
    // we need to check the subsequent step. But since we don't have that info here,
    // we apply business hours if specified in the wait config
    if (config.respectBusinessHours && businessHours) {
      scheduledTime = getNextBusinessHoursTime(scheduledTime, businessHours);
    }

    return scheduledTime;
  }

  // For voice_call steps, ensure we're within business hours
  if (nextStep.type === 'voice_call' && businessHours) {
    return getNextBusinessHoursTime(now, businessHours);
  }

  // Default: schedule immediately
  return now;
}
