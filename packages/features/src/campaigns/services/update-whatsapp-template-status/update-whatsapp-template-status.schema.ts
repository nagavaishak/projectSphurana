import { z } from 'zod';

/**
 * Input for reconciling a WhatsApp template's approval status from a Meta
 * `message_template_status_update` webhook.
 *
 * Template-status events are WABA-scoped (they arrive on the WhatsApp Business
 * Account, not a phone number), so the org is resolved from `wabaId`. Meta
 * identifies the template by a numeric id and/or name+language; we accept both
 * and match on whichever is present (id first, name+language as a fallback).
 */
export const updateWhatsappTemplateStatusSchema = z.object({
  wabaId: z.string().min(1),
  /** Meta's numeric template id, stringified. Matches `whatsappTemplate.metaTemplateId`. */
  metaTemplateId: z.string().optional(),
  /** Template name — fallback identifier when no metaTemplateId is stored yet. */
  name: z.string().optional(),
  /** BCP-47 language code (e.g. `en`, `en_US`) — pairs with `name`. */
  languageCode: z.string().optional(),
  /** Meta's status event, e.g. APPROVED / REJECTED / PAUSED / DISABLED / PENDING. */
  event: z.string().min(1),
});

export type UpdateWhatsappTemplateStatusInput = z.infer<
  typeof updateWhatsappTemplateStatusSchema
>;
