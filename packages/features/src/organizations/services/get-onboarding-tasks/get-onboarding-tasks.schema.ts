import { z } from 'zod';

/**
 * Schema for getting onboarding tasks
 */
export const getOnboardingTasksSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetOnboardingTasksInput = z.infer<typeof getOnboardingTasksSchema>;
