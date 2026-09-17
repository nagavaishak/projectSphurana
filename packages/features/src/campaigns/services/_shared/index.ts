// Shared campaign service helpers
export {
  type EligibilityLead,
  type SuppressionIndex,
  emptySuppressionIndex,
  normalizeContact,
  contactForChannel,
  isChannelEligible,
  eligibleChannels,
  buildSuppressionIndex,
} from './channel-eligibility.js';

export { buildSegmentWhere } from './build-segment-where.js';

export { CAMPAIGN_VOICE_RULES } from './copy-voice.js';

export {
  type MergeData,
  interpolateCampaignBody,
  extractMergeFields,
  fieldsWithoutFallback,
  unknownMergeFields,
} from './interpolate-campaign-body.js';

export {
  type ChannelCounts,
  type CostEstimate,
  type ChannelCostLine,
  estimateCampaignCost,
  CAMPAIGN_PAID_CHANNELS,
} from './estimate-cost.js';

export {
  type CampaignSend,
  isWithinAttributionWindow,
  attributeConversion,
  DEFAULT_ATTRIBUTION_WINDOW_DAYS,
} from './attribution-window.js';

export {
  type TrackingTokenPayload,
  signTrackingToken,
  verifyTrackingToken,
} from './tracking-token.js';

export {
  getTrackingSecret,
  getTrackingBaseUrl,
  buildUnsubscribeUrl,
} from './tracking-secret.js';

export {
  type SendChannel,
  type SendAction,
  type PlanSendInput,
  type SendPlan,
  planSend,
  buildLeadMergeData,
} from './plan-send.js';

export {
  segmentFilterSchema,
  type SegmentFilterInput,
} from './segment-filter.schema.js';

export type {
  AvailableSmsNumber,
  ProvisionedSmsNumber,
  SmsNumberProvider,
} from './sms-number-provider.js';

export {
  ALPHA_SENDER_ID_MAX_LENGTH,
  isValidAlphaSenderId,
  deriveAlphaSenderId,
} from './alpha-sender-id.js';

export {
  type ResolvedSmsSender,
  type ResolveSmsSenderInput,
  resolveSmsSender,
} from './resolve-sms-sender.js';
