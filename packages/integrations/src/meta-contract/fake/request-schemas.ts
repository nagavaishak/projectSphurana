import type { z } from 'zod';
import * as s from '../schemas.js';

/**
 * endpoint id → the strict request schema the fake enforces.
 *
 * Kept separate from `endpoints.ts` so the registry stays a plain declarative
 * list with no schema imports, and separate from `schemas.ts` so the schemas
 * can be imported by the contract TESTS without pulling in the fake.
 *
 * EVERY WRITE ENDPOINT MUST APPEAR HERE **OR** IN `UNVALIDATED_WRITES`.
 * `contract-completeness.test.ts` enforces that. A write endpoint that is
 * silently absent from both accepts any payload, which quietly removes the
 * "someone added a parameter" detection this module exists to provide — the
 * failure mode being that the gap is invisible in review.
 */
export const REQUEST_SCHEMAS: Record<string, z.ZodType> = {
  // Marketing API writes
  'ads.createCampaign': s.createCampaignRequest,
  'ads.createAdSet': s.createAdSetRequest,
  'ads.createAdCreative': s.createAdCreativeRequest,
  'ads.createAd': s.createAdRequest,
  'ads.createLeadGenForm': s.createLeadGenFormRequest,
  'ads.duplicateCampaign': s.copyCampaignRequest,

  // Messaging writes
  'messaging.send': s.sendMessageRequest,
  'whatsapp.sendMessage': s.whatsappSendRequest,

  // Page + Instagram publishing (urlencoded bodies)
  'pages.publishFeed': s.publishFeedRequest,
  'pages.publishPhoto': s.publishPhotoRequest,
  'pages.publishVideo': s.publishVideoRequest,
  'instagram.createMedia': s.instagramCreateMediaRequest,
  'instagram.publishMedia': s.instagramPublishRequest,

  // Webhook subscription + template management
  'pages.subscribeApp': s.subscribeAppRequest,
  'whatsapp.createTemplate': s.createWhatsAppTemplateRequest,
};

/**
 * Write endpoints deliberately NOT schema-validated, each with the reason.
 *
 * This is an explicit, reviewable list rather than an absence. "We can't
 * validate this" is a legitimate engineering answer; "nobody noticed this
 * wasn't validated" is not, and the two look identical when the gap is just a
 * missing map entry.
 */
export const UNVALIDATED_WRITES: Record<string, string> = {
  'ads.uploadVideo':
    'Hand-built multipart Buffer. The JSON start/finish phases could be validated, but the transfer phase is binary — a JSON schema is the wrong tool. Phase behaviour is covered by fake/upload.test.ts, which drives the real uploader.',
  'ads.uploadImage':
    'Hand-built multipart Buffer carrying raw image bytes. Nothing JSON-shaped to validate; covered by fake/upload.test.ts.',
  'whatsapp.deleteTemplate':
    'No request body — the template name travels in the query string.',
  'node.delete':
    'No request body at all — `DELETE /{id}` carries the target in the path and the credentials in the query string. There is nothing to validate.',
  'node.update':
    'Genuinely free-form: `POST /{id}` accepts whatever mutable fields the caller passes (campaign, ad set, ad, creative all share this path). A schema here would either be `z.record` (no signal) or wrong.',
};
