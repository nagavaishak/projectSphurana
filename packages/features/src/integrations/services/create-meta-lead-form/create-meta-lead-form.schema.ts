import { z } from 'zod';

export const createMetaLeadFormSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Form name is required'),
  questions: z.array(
    z.object({
      type: z.string(),
      label: z.string().optional(),
      key: z.string().optional(),
      options: z
        .array(
          z.object({
            value: z.string(),
            key: z.string().optional(),
          })
        )
        .optional(),
    })
  ),
  // Optional — the service falls back to the org's website / Facebook Page when
  // no dedicated policy is supplied (Meta requires a URL on the form).
  privacyPolicyUrl: z.string().url('Invalid privacy policy URL').optional(),
  thankYouPage: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      buttonText: z.string().optional(),
      buttonUrl: z.string().optional(),
    })
    .optional(),
});

export type CreateMetaLeadFormInput = z.infer<typeof createMetaLeadFormSchema>;
