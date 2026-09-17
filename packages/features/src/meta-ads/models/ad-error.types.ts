/**
 * Ad-specific error codes
 */
export const AdErrorCodes = {
  /** Ad not found */
  AD_NOT_FOUND: 'AD_NOT_FOUND',
  /** Ad is not in a valid state for the operation */
  INVALID_AD_STATE: 'INVALID_AD_STATE',
  /** Video not found or not accessible */
  VIDEO_NOT_FOUND: 'VIDEO_NOT_FOUND',
  /** Video is not ready for ads (still processing) */
  VIDEO_NOT_READY: 'VIDEO_NOT_READY',
  /** Campaign not found */
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  /** Campaign is not published to Meta */
  CAMPAIGN_NOT_PUBLISHED: 'CAMPAIGN_NOT_PUBLISHED',
  /** Failed to upload video to Meta */
  META_VIDEO_UPLOAD_FAILED: 'META_VIDEO_UPLOAD_FAILED',
  /** Failed to create ad on Meta */
  META_AD_CREATE_FAILED: 'META_AD_CREATE_FAILED',
  /** Failed to sync ad with Meta */
  META_SYNC_FAILED: 'META_SYNC_FAILED',
  /** Social post not found or not in a valid state for ad creation */
  SOCIAL_POST_NOT_ELIGIBLE: 'SOCIAL_POST_NOT_ELIGIBLE',
  /** Meta ad account has no valid payment method */
  META_PAYMENT_METHOD_REQUIRED: 'META_PAYMENT_METHOD_REQUIRED',
  /** Facebook Page has not accepted Lead Generation Terms of Service */
  META_LEAD_GEN_TOS_REQUIRED: 'META_LEAD_GEN_TOS_REQUIRED',
  /** Meta access token expired/revoked — user must reconnect */
  META_AUTH_EXPIRED: 'META_AUTH_EXPIRED',
  /** User must take action in Meta (TOS, verification, etc.) */
  META_USER_ACTION_REQUIRED: 'META_USER_ACTION_REQUIRED',
  /** Meta API rate limit reached */
  META_RATE_LIMITED: 'META_RATE_LIMITED',
  /** Meta ad account or business is restricted */
  META_ACCOUNT_RESTRICTED: 'META_ACCOUNT_RESTRICTED',
  /** Organization has no active WhatsApp Business account connected */
  META_WHATSAPP_DISCONNECTED: 'META_WHATSAPP_DISCONNECTED',
  /** The selected Page is not linked to the org's WhatsApp Business account */
  META_WHATSAPP_PHONE_NOT_LINKED: 'META_WHATSAPP_PHONE_NOT_LINKED',
  /**
   * The connected WhatsApp number is a Meta-provided free "555" number.
   * These are ineligible for click-to-WhatsApp ads — Meta rejects them
   * from `promoted_object.whatsapp_phone_number`.
   */
  META_WHATSAPP_FREE_NUMBER_INELIGIBLE: 'META_WHATSAPP_FREE_NUMBER_INELIGIBLE',
} as const;

export type AdErrorCode = (typeof AdErrorCodes)[keyof typeof AdErrorCodes];
