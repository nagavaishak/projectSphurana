import { z } from 'zod';

/**
 * Meta Lead Webhook payload schema
 * @see https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 */

// Individual field data item
const fieldDataSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

// Lead data from leadgen_id lookup
export const metaLeadDataSchema = z.object({
  id: z.string(), // leadgen_id
  created_time: z.string(),
  form_id: z.string(),
  page_id: z.string(),
  // Meta sends `null` (not an absent key) for these on organic and test leads.
  // `.optional()` accepts undefined but REJECTS null, which failed the whole
  // strict payload parse and 400'd the webhook — see ENG-786.
  ad_id: z.string().nullish(),
  adgroup_id: z.string().nullish(),
  campaign_id: z.string().nullish(),
  field_data: z.array(fieldDataSchema),
});

export type MetaLeadData = z.infer<typeof metaLeadDataSchema>;

// Webhook entry change value
const webhookChangeValueSchema = z.object({
  form_id: z.string(),
  leadgen_id: z.string(),
  created_time: z.number(),
  page_id: z.string(),
  // Organic submissions and Meta's own Test button send `ad_id: null` /
  // `adgroup_id: null`. `z.string().optional()` rejects null, so the strict
  // payload parse failed and the controller returned 400 — the entire webhook
  // was dropped and Meta retried for ~36h then gave up (ENG-786).
  ad_id: z.string().nullish(),
  adgroup_id: z.string().nullish(),
});

// Webhook entry change
const webhookChangeSchema = z.object({
  field: z.literal('leadgen'),
  value: webhookChangeValueSchema,
});

// Webhook entry
const webhookEntrySchema = z.object({
  id: z.string(),
  time: z.number(),
  changes: z.array(webhookChangeSchema),
});

// Full webhook payload
export const metaWebhookPayloadSchema = z.object({
  object: z.literal('page'),
  entry: z.array(webhookEntrySchema),
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

// Input for our handler
export const handleMetaLeadWebhookInputSchema = z.object({
  payload: z.string(), // Raw JSON string
  signature: z.string(), // X-Hub-Signature-256 header
});

export type HandleMetaLeadWebhookInput = z.infer<
  typeof handleMetaLeadWebhookInputSchema
>;
