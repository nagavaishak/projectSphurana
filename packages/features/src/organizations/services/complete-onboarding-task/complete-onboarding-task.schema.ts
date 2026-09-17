import type { OnboardingTask } from '@borradh-workspace/database';
import { onboardingTaskValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for completing an onboarding task
 */
export const completeOnboardingTaskSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  taskId: z.enum(onboardingTaskValues),
  /** Passed from controller for Loops marketing events. Not validated. */
  userEmail: z.string().optional(),
});

/**
 * Input type inferred from schema
 */
export type CompleteOnboardingTaskInput = z.infer<
  typeof completeOnboardingTaskSchema
>;

/**
 * Response type for complete-onboarding-task
 */
export interface CompleteOnboardingTaskResponse {
  completedTasks: OnboardingTask[];
}
