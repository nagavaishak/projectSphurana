import { z } from 'zod';

export const startOnboardingWebsiteAnalysisSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  websiteUrl: z.string().url('Invalid website URL'),
});

export type StartOnboardingWebsiteAnalysisInput = z.infer<
  typeof startOnboardingWebsiteAnalysisSchema
>;
