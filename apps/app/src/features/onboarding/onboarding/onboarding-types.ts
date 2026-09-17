import { z } from 'zod';

export const onboardingSchema = z.object({
  // Step 1: Website analysis
  websiteUrl: z.string().url().optional(),
  jobId: z.string().optional(),
  analysisComplete: z.boolean().optional(),

  // Step 3: Path choice
  path: z.enum(['create-content', 'launch-ad', 'skip']).optional(),

  // Step 4: Upload
  uploadedAssetIds: z.array(z.string()).optional(),

  // Step 5: Content generation (primary path only)
  generatedContentIds: z.array(z.string()).optional(),

  // Step 6: Ad selection
  selectedAdContentId: z.string().optional(),

  // Step 7: Trial
  stripeSubscriptionId: z.string().optional(),

  // Step 8: Meta connect
  metaConnected: z.boolean().optional(),

  // Step 9: Campaign
  campaignId: z.string().optional(),

  // Step 11: Chatbot
  chatbotEnabled: z.boolean().optional(),
});

export type OnboardingFormData = z.infer<typeof onboardingSchema>;

export type OnboardingPath = 'create-content' | 'launch-ad' | 'skip';

export interface OnboardingStepProps {
  formData: OnboardingFormData;
  onUpdate: (data: Partial<OnboardingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export const STORAGE_KEY = 'onboarding_funnel_state';
