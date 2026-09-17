import { z } from 'zod';

export const createWhatsappTemplateSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^[a-z0-9_]+$/,
      'Template name must be lowercase alphanumeric with underscores only'
    ),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  language: z.string().min(2).max(10).default('en'),
  body: z.string().min(1).max(1024),
  headerText: z.string().max(60).optional(),
  footerText: z.string().max(60).optional(),
  /** One sample per `{{n}}` in `body`, in order. Required by Meta when the
   * body has variables — see CreateWhatsAppTemplateInput. */
  bodyExample: z.array(z.string().min(1)).optional(),
});

export type CreateWhatsappTemplateInput = z.infer<
  typeof createWhatsappTemplateSchema
>;
