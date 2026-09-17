import { leadFormFollowUpChannelValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  leadFormQuestionSchema,
  requireWhatsappNumberForWhatsappChannel,
  whatsappNumberRefinement,
} from '../create-lead-form/create-lead-form.schema.js';

/**
 * Schema for updating a lead form
 */
export const updateLeadFormSchema = z.object({
  id: z.string().min(1, 'Lead form ID is required'),
  organizationId: z.string().optional(), // Optional for access control

  // Updateable fields
  name: z.string().min(1).max(100).optional(),
  questions: z.array(leadFormQuestionSchema).min(1).optional(),
  privacyPolicyUrl: z.string().url().optional(),
  privacyPolicyLinkText: z.string().optional(),
  thankYouTitle: z.string().max(100).optional().nullable(),
  thankYouBody: z.string().max(500).optional().nullable(),
  thankYouButtonText: z.string().max(50).optional().nullable(),
  thankYouButtonUrl: z.string().url().optional().nullable(),
  followUpChannel: z.enum(leadFormFollowUpChannelValues).optional(),
  whatsappNumber: z.string().max(20).optional().nullable(),
  metaPageId: z.string().optional().nullable(),

  // Whether to re-sync to Meta after update
  syncToMeta: z.boolean().optional().default(false),
});

/**
 * The schema the service validates against. Enforces the same WhatsApp pairing
 * as create (ENG-629 #4). `followUpChannel` is optional here, so the refine only
 * fires when the channel is actually being set to `whatsapp`. Kept separate from
 * `updateLeadFormSchema` (a plain `ZodObject`) because the API DTO calls
 * `.omit()` on that one, which a refined `ZodEffects` does not support.
 */
export const updateLeadFormInputSchema = updateLeadFormSchema.refine(
  requireWhatsappNumberForWhatsappChannel,
  whatsappNumberRefinement
);

/**
 * Input type inferred from schema
 */
export type UpdateLeadFormInput = z.infer<typeof updateLeadFormSchema>;
