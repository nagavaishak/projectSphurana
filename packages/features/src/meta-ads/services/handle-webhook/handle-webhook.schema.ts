import { z } from 'zod';

/**
 * Meta webhook entry schema
 */
const webhookEntrySchema = z.object({
  id: z.string(),
  time: z.number(),
  changes: z.array(
    z.object({
      field: z.string(),
      value: z.any(),
    })
  ),
});

/**
 * Schema for Meta webhook payload
 */
export const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(webhookEntrySchema),
});

/**
 * Ad status change webhook value
 */
export const adStatusChangeSchema = z.object({
  ad_id: z.string(),
  account_id: z.string(),
  effective_status: z.string().optional(),
  configured_status: z.string().optional(),
  deleted: z.boolean().optional(),
});

/**
 * Campaign status change webhook value
 */
export const campaignStatusChangeSchema = z.object({
  campaign_id: z.string(),
  account_id: z.string(),
  effective_status: z.string().optional(),
  configured_status: z.string().optional(),
  deleted: z.boolean().optional(),
});

/**
 * Schema for handling webhook
 */
export const handleWebhookSchema = z.object({
  payload: metaWebhookSchema,
  signature: z.string().min(1, 'Signature is required'),
  rawBody: z.string().min(1, 'Raw body is required'),
});

/**
 * Input type for handling webhook
 */
export type HandleWebhookInput = z.infer<typeof handleWebhookSchema>;
export type MetaWebhookPayload = z.infer<typeof metaWebhookSchema>;
export type AdStatusChange = z.infer<typeof adStatusChangeSchema>;
export type CampaignStatusChange = z.infer<typeof campaignStatusChangeSchema>;
