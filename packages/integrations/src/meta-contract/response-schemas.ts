import type { z } from 'zod';
import * as s from './schemas.js';

/**
 * endpoint id → the response schema real Meta traffic is validated against on
 * the nightly run (`META_CONTRACT_VALIDATE=1`).
 *
 * These are PASSTHROUGH schemas: Meta adding a field is a non-event. Only a
 * MISSING or type-CHANGED field that our code actually reads counts as drift.
 *
 * An endpoint absent from this map is simply not validated. That is fine for
 * endpoints whose response we ignore (sender actions, subscriptions) — there is
 * no contract to break if nothing reads the body.
 *
 * ⚠ Provenance: these currently describe what our `apiRequest<{…}>` type
 * generics claim Meta returns. Reconcile against `graph-recordings.ndjson`
 * before merge — see the header of `schemas.ts`.
 */
export const RESPONSE_SCHEMAS: Record<string, z.ZodType> = {
  // Creates — the id is load-bearing (`requireId` throws without it).
  'ads.createCampaign': s.idResponse,
  'ads.createAdSet': s.idResponse,
  'ads.createAdCreative': s.idResponse,
  'ads.createAd': s.idResponse,
  'ads.createLeadGenForm': s.idResponse,

  // Media upload.
  'ads.uploadImage': s.uploadImageResponse,
  'ads.uploadVideo': s.uploadVideoResponse,

  // Reads.
  'node.get': s.getAdResponse,
  'ads.listAds': s.listResponse,
  'ads.listCampaigns': s.listResponse,
  'ads.listCampaignAds': s.listResponse,
  'ads.listCampaignAdSets': s.listResponse,
  'ads.listLeadGenForms': s.listResponse,
  'ads.listFormLeads': s.listResponse,
  'ads.listCampaignInsights': s.listResponse,
  'ads.nodeInsights': s.listResponse,
  'pages.listPosts': s.listResponse,
  'messaging.listConversations': s.listResponse,
  'whatsapp.listTemplates': s.listResponse,

  // Messaging sends.
  'messaging.send': s.sendMessageResponse,
  'whatsapp.sendMessage': s.whatsappSendResponse,

  // Publishing.
  'pages.publishFeed': s.publishPostResponse,
  'pages.publishPhoto': s.publishPostResponse,
  'pages.publishVideo': s.publishPostResponse,
  'instagram.createMedia': s.idResponse,
  'instagram.publishMedia': s.idResponse,
  'instagram.getSenderProfile': s.instagramProfileResponse,

  // Acknowledgements + reads that were previously unvalidated.
  // `ads.getFundingSource` gates whether an account can publish at all, so a
  // shape change there is a publishing outage, not a cosmetic drift.
  'ads.getFundingSource': s.fundingSourceResponse,
  'pages.subscribeApp': s.mutationAckResponse,
  'whatsapp.createTemplate': s.whatsAppTemplateResponse,
  'whatsapp.deleteTemplate': s.mutationAckResponse,
  'node.update': s.mutationAckResponse,
  'node.delete': s.mutationAckResponse,
  // The copy id is load-bearing — `copyCampaign` has nothing to return without
  // it, and the duplicate silently becomes a no-op.
  'ads.duplicateCampaign': s.copyCampaignResponse,
};
