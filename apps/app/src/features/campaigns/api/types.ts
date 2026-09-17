/**
 * Messaging Campaigns — frontend types.
 *
 * Localized here (not in @borradh-workspace/api-client/types) because the
 * api-client barrel already exports `Campaign`/`CreateCampaignInput` for the
 * Meta Ads feature. We derive from the backend feature types with `Serialize`
 * (Date -> string) and re-export the labels for UI dropdowns.
 */
import type { Serialize } from '@borradh-workspace/api-client/types';
import type { WhatsappTemplateAtom } from '@borradh-workspace/contracts';
import {
  type CampaignChannel,
  type CampaignRecipientStatus,
  type CampaignStatus,
  type CampaignType,
  type SmsNumberStatus,
  type SuppressionReason,
  campaignChannelLabels,
  campaignChannelValues,
  campaignStatusLabels,
  campaignStatusValues,
  campaignTypeLabels,
  campaignTypeValues,
  smsNumberStatusLabels,
  whatsappTemplateStatusLabels,
} from '@borradh-workspace/labels';

import type {
  AvailableSmsNumber as BackendAvailableSmsNumber,
  Campaign as BackendCampaign,
  CampaignAnalytics as BackendCampaignAnalytics,
  CampaignMessage as BackendCampaignMessage,
  CampaignRecipient as BackendCampaignRecipient,
  CampaignRecipientRow as BackendCampaignRecipientRow,
  CreateCampaignInput as BackendCreateCampaignInput,
  CreateSegmentInput as BackendCreateSegmentInput,
  OrgSmsNumber as BackendOrgSmsNumber,
  PreviewSegmentInput as BackendPreviewSegmentInput,
  SampleRecipient as BackendSampleRecipient,
  Segment as BackendSegment,
  Suppression as BackendSuppression,
  UpdateCampaignInput as BackendUpdateCampaignInput,
  EnsureCampaignWhatsappTemplateStatus,
  SegmentFilter,
} from '@borradh-workspace/features/campaigns';

// ── Enums / labels (re-exported for UI) ───────────────────────────────────
export type {
  CampaignChannel,
  CampaignRecipientStatus,
  CampaignStatus,
  CampaignType,
  SmsNumberStatus,
  SuppressionReason,
};
export {
  campaignChannelLabels,
  campaignChannelValues,
  campaignStatusLabels,
  campaignStatusValues,
  campaignTypeLabels,
  campaignTypeValues,
  smsNumberStatusLabels,
  whatsappTemplateStatusLabels,
};
export type { SegmentFilter };

// ── Entities (Date -> string via Serialize) ───────────────────────────────
export type Campaign = Serialize<BackendCampaign>;
// `whatsappTemplateParams` is optional (not `| null` like the backend row)
// until the generated contract atom picks the new column up — regenerate with
// `pnpm --filter @borradh-workspace/contracts contracts:generate`. Optional
// stays assignable either way, so this needs no follow-up edit.
export type CampaignMessage = Omit<
  Serialize<BackendCampaignMessage>,
  'whatsappTemplateParams'
> & { whatsappTemplateParams?: string[] | null };
export type CampaignRecipient = Serialize<BackendCampaignRecipient>;
export type Segment = Serialize<BackendSegment>;
export type Suppression = Serialize<BackendSuppression>;

/** Funnel counts for a campaign (GET /campaigns/:id/analytics). */
export type CampaignAnalytics = BackendCampaignAnalytics;

/** A campaign with its per-channel messages (the GET /campaigns/:id shape). */
export type CampaignWithMessages = Campaign & { messages: CampaignMessage[] };

/** Per-recipient outcome row (GET /campaigns/:id/recipients). */
export type CampaignRecipientRow = Serialize<BackendCampaignRecipientRow>;

/** The org's campaign SMS sender number (GET /campaigns/sms-number). */
export type SmsNumber = Serialize<BackendOrgSmsNumber>;

/** A purchasable Twilio number (GET /campaigns/sms-number/available). */
export type AvailableSmsNumber = BackendAvailableSmsNumber;

/** A synced WhatsApp template row (GET /campaigns/whatsapp-templates). */
export type WhatsappTemplate = WhatsappTemplateAtom;

/** GET /campaigns/whatsapp-templates response. */
export interface WhatsappTemplatesResponse {
  templates: WhatsappTemplate[];
  synced: boolean;
}

// ── Composer mail-merge preview (POST /campaigns/segments/sample-recipients) ──

/** One eligible lead's merge fields, for the mail-merge preview pager. */
export type SampleRecipient = BackendSampleRecipient;

/** POST /campaigns/segments/sample-recipients response. */
export interface SampleRecipientsResponse {
  recipients: SampleRecipient[];
}

/** POST /campaigns/segments/sample-recipients body (org from session). */
export interface SampleRecipientsInput {
  filterJson: SegmentFilter;
  channel: CampaignChannel;
  limit?: number;
}

// ── Auto-provision canonical WhatsApp template ─────────────────────────────
// (POST /campaigns/whatsapp-templates/ensure)

/** Status of the org's canonical `borradh_campaign_message` template. */
export type EnsureWhatsappTemplateStatus = EnsureCampaignWhatsappTemplateStatus;

/** POST /campaigns/whatsapp-templates/ensure response. */
export interface EnsureWhatsappTemplateResponse {
  status: EnsureWhatsappTemplateStatus;
}

/** Buy an SMS number (POST /campaigns/sms-number). */
export interface ProvisionSmsNumberInput {
  country: string;
  phoneNumber: string;
}

// ── List responses ────────────────────────────────────────────────────────

/** List row: campaign plus audience name and per-channel recipient counts. */
export type CampaignListItem = Campaign & {
  segmentName: string | null;
  recipientCounts: Partial<Record<CampaignChannel, number>>;
};

export interface CampaignListResponse {
  items: CampaignListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SegmentListResponse {
  items: Segment[];
  total: number;
  limit: number;
  offset: number;
}

export interface SuppressionListResponse {
  items: Suppression[];
  total: number;
  limit: number;
  offset: number;
}

export interface SegmentPreviewResponse {
  total: number;
  reachable: number;
  channels: Record<CampaignChannel, number>;
}

export interface LaunchCampaignResponse {
  campaignId: string;
  materialized: number;
  enqueued: number;
}

// ── Inputs (omit server-derived fields) ───────────────────────────────────
export type CreateCampaignInput = Omit<
  BackendCreateCampaignInput,
  'organizationId' | 'createdById'
>;
export type UpdateCampaignInput = Omit<
  BackendUpdateCampaignInput,
  'organizationId' | 'id'
>;
export type CreateSegmentInput = Omit<
  BackendCreateSegmentInput,
  'organizationId' | 'createdById'
>;
export type PreviewSegmentInput = Omit<
  BackendPreviewSegmentInput,
  'organizationId' | 'channels'
> & { channels?: CampaignChannel[] };

export interface UpsertCampaignMessageInput {
  channel: CampaignChannel;
  subject?: string;
  body: string;
  whatsappTemplateId?: string;
  whatsappTemplateParams?: string[];
  mediaUrl?: string;
}
