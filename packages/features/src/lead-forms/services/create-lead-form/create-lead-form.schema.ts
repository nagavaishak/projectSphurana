import {
  leadFormFieldTypeValues,
  leadFormFollowUpChannelValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for a single lead form question
 */
export const leadFormQuestionSchema = z.object({
  type: z.enum(leadFormFieldTypeValues),
  label: z.string().optional(),
  key: z.string().optional(),
  options: z
    .array(z.object({ value: z.string(), key: z.string().optional() }))
    .optional(),
  required: z.boolean().optional(),
});

/**
 * Schema for creating a new lead form
 */
export const createLeadFormSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Name is required').max(100),
  questions: z
    .array(leadFormQuestionSchema)
    .min(1, 'At least one question is required'),

  // Privacy policy. Meta requires one on the form, but callers may omit it —
  // the service falls back to the org's website / Facebook Page
  // (resolveOrgPrivacyPolicyUrl) so a missing policy doesn't block creation.
  privacyPolicyUrl: z
    .string()
    .url('Privacy policy must be a valid URL')
    .optional(),
  privacyPolicyLinkText: z.string().optional(),

  // Thank you page (optional)
  thankYouTitle: z.string().max(100).optional(),
  thankYouBody: z.string().max(500).optional(),
  thankYouButtonText: z.string().max(50).optional(),
  thankYouButtonUrl: z.string().url().optional(),

  // Instant-form lead nurturing
  followUpChannel: z.enum(leadFormFollowUpChannelValues).optional(),
  whatsappNumber: z.string().max(20).optional().nullable(),

  // Meta page to sync to (optional, uses default if not provided)
  metaPageId: z.string().optional(),

  // Who created this form
  createdById: z.string().optional(),

  // Whether to immediately sync to Meta after creation
  syncToMeta: z.boolean().optional().default(false),
});

/**
 * A WhatsApp follow-up needs a business number: the sync service only builds the
 * WhatsApp chat CTA when `followUpChannel === 'whatsapp' && whatsappNumber` is
 * present, so a WhatsApp form saved without a number would sync "successfully"
 * with no chat button (ENG-629 #4). Enforce the pairing at validation time.
 *
 * Written as a predicate so the create and update schemas share one rule. On the
 * update schema `followUpChannel` is optional, so this only fires when the
 * channel is actually being set to `whatsapp`.
 */
export const requireWhatsappNumberForWhatsappChannel = (data: {
  followUpChannel?: string | null;
  whatsappNumber?: string | null;
}): boolean =>
  data.followUpChannel !== 'whatsapp' ||
  (typeof data.whatsappNumber === 'string' &&
    data.whatsappNumber.trim().length > 0);

export const whatsappNumberRefinement = {
  message:
    'A WhatsApp number is required when the follow-up channel is WhatsApp',
  path: ['whatsappNumber'],
};

/**
 * The schema the service validates against. Kept separate from
 * `createLeadFormSchema` (a plain `ZodObject`) because the API DTO calls
 * `.omit()` on that one, which a refined `ZodEffects` does not support.
 */
export const createLeadFormInputSchema = createLeadFormSchema.refine(
  requireWhatsappNumberForWhatsappChannel,
  whatsappNumberRefinement
);

/**
 * Input type inferred from schema
 */
export type CreateLeadFormInput = z.infer<typeof createLeadFormSchema>;
