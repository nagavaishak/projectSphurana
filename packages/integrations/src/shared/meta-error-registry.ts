/**
 * Comprehensive Meta API Error Registry
 *
 * Maps Meta error codes + subcodes to structured, actionable error information.
 * This enables the frontend to show specific dialogs with instructions rather
 * than generic error toasts.
 *
 * References:
 * - https://developers.facebook.com/docs/graph-api/guides/error-handling/
 * - https://developers.facebook.com/docs/messenger-platform/error-codes/
 * - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes/
 * - https://developers.facebook.com/docs/marketing-api/error-reference/
 * - https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Granular classification of Meta errors for routing to the correct handler */
export type MetaErrorCategory =
  | 'auth_required' // Token expired/revoked — user must reconnect
  | 'user_action_required' // User must perform an action in Meta (TOS, verify, etc.)
  | 'permission_denied' // Missing permission scope
  | 'rate_limited' // Too many requests — retry with backoff
  | 'messaging_window' // Outside 24-hour messaging window
  | 'user_blocked' // Recipient blocked your business — stop messaging
  | 'content_error' // Media/content validation failure
  | 'payment_required' // Payment method missing or invalid
  | 'account_restricted' // Account blocked/restricted by Meta
  | 'not_found' // Object doesn't exist
  | 'sender_action_rejected' // A cosmetic sender_action (typing/seen) was refused — implies nothing about the recipient
  | 'transient' // Temporary failure — safe to retry
  | 'unknown'; // Unclassified

/** Structured error info returned to the frontend */
export interface MetaErrorInfo {
  /** Unique key identifying this error type (used by frontend to select dialog) */
  errorKey: string;
  /** Error category for routing */
  category: MetaErrorCategory;
  /** User-facing dialog title */
  userTitle: string;
  /** User-facing explanation */
  userMessage: string;
  /**
   * URL where the user can fix the issue.
   * May contain `{pageId}`, `{adAccountId}` placeholders for dynamic URLs.
   */
  actionUrl?: string;
  /** Button label for the action URL */
  actionLabel?: string;
  /**
   * Slug identifying the instructional video to show.
   * The frontend maps this to an actual video URL/embed.
   */
  videoGuideSlug?: string;
  /** Whether the system should automatically retry */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Error key constants — used by both backend and frontend
// ---------------------------------------------------------------------------

export const MetaErrorKeys = {
  // Auth
  AUTH_TOKEN_EXPIRED: 'META_AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_REVOKED: 'META_AUTH_TOKEN_REVOKED',
  AUTH_APP_REMOVED: 'META_AUTH_APP_REMOVED',
  AUTH_PASSWORD_CHANGED: 'META_AUTH_PASSWORD_CHANGED',
  AUTH_SESSION_EXPIRED: 'META_AUTH_SESSION_EXPIRED',
  AUTH_INVALID_APPSECRET: 'META_AUTH_INVALID_APPSECRET',

  // User action required
  USER_CHECKPOINT: 'META_USER_CHECKPOINT',
  USER_UNCONFIRMED: 'META_USER_UNCONFIRMED',
  USER_ACCOUNT_FLAGGED: 'META_USER_ACCOUNT_FLAGGED',
  USER_MISSING_PAGE_ROLE: 'META_USER_MISSING_PAGE_ROLE',

  // TOS / Policy
  TOS_LEAD_GEN: 'META_TOS_LEAD_GEN',
  TOS_CUSTOM_AUDIENCE: 'META_TOS_CUSTOM_AUDIENCE',
  TOS_NONDISCRIMINATION: 'META_TOS_NONDISCRIMINATION',
  POLICY_VIOLATION: 'META_POLICY_VIOLATION',
  ADS_ACCESS_REVOKED: 'META_ADS_ACCESS_REVOKED',
  CONTENT_BANNED: 'META_CONTENT_BANNED',

  // DSA / Ad Transparency
  DSA_BENEFICIARY_REQUIRED: 'META_DSA_BENEFICIARY_REQUIRED',

  // Payment
  PAYMENT_METHOD_REQUIRED: 'META_PAYMENT_METHOD_REQUIRED',
  PAYMENT_DECLINED: 'META_PAYMENT_DECLINED',
  BUDGET_TOO_LOW: 'META_BUDGET_TOO_LOW',
  SPENDING_LIMIT_REACHED: 'META_SPENDING_LIMIT_REACHED',

  // Account
  AD_ACCOUNT_DISABLED: 'META_AD_ACCOUNT_DISABLED',
  BUSINESS_VERIFICATION_REQUIRED: 'META_BUSINESS_VERIFICATION_REQUIRED',
  ACCOUNT_RESTRICTED: 'META_ACCOUNT_RESTRICTED',
  IG_ACCOUNT_RESTRICTED: 'META_IG_ACCOUNT_RESTRICTED',
  WHATSAPP_DISCONNECTED: 'META_WHATSAPP_DISCONNECTED',
  WHATSAPP_PHONE_NOT_LINKED: 'META_WHATSAPP_PHONE_NOT_LINKED',
  WHATSAPP_PERSONAL_ACCOUNT: 'META_WHATSAPP_PERSONAL_ACCOUNT',

  // WhatsApp Cloud API runtime errors
  // https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
  WHATSAPP_GENERIC_ERROR: 'META_WHATSAPP_GENERIC_ERROR',
  WHATSAPP_ACCESS_DENIED: 'META_WHATSAPP_ACCESS_DENIED',
  WHATSAPP_REQUIRED_PARAMETER_MISSING:
    'META_WHATSAPP_REQUIRED_PARAMETER_MISSING',
  WHATSAPP_SERVICE_UNAVAILABLE: 'META_WHATSAPP_SERVICE_UNAVAILABLE',
  WHATSAPP_RECIPIENT_CANNOT_BE_SENT: 'META_WHATSAPP_RECIPIENT_CANNOT_BE_SENT',
  WHATSAPP_MESSAGE_UNDELIVERABLE: 'META_WHATSAPP_MESSAGE_UNDELIVERABLE',
  WHATSAPP_ACCOUNT_LOCKED: 'META_WHATSAPP_ACCOUNT_LOCKED',
  WHATSAPP_UNSUPPORTED_MESSAGE_TYPE: 'META_WHATSAPP_UNSUPPORTED_MESSAGE_TYPE',
  WHATSAPP_MEDIA_DOWNLOAD_ERROR: 'META_WHATSAPP_MEDIA_DOWNLOAD_ERROR',
  WHATSAPP_RATE_LIMIT: 'META_WHATSAPP_RATE_LIMIT',
  WHATSAPP_TIER_LIMIT_REACHED: 'META_WHATSAPP_TIER_LIMIT_REACHED',
  WHATSAPP_TEMPLATE_PARAM_MISMATCH: 'META_WHATSAPP_TEMPLATE_PARAM_MISMATCH',
  WHATSAPP_TEMPLATE_NOT_FOUND: 'META_WHATSAPP_TEMPLATE_NOT_FOUND',
  WHATSAPP_TEMPLATE_LANGUAGE_INVALID: 'META_WHATSAPP_TEMPLATE_LANGUAGE_INVALID',
  WHATSAPP_TEMPLATE_PAUSED: 'META_WHATSAPP_TEMPLATE_PAUSED',
  WHATSAPP_TEMPLATE_DISABLED: 'META_WHATSAPP_TEMPLATE_DISABLED',
  WHATSAPP_REGISTRATION_PHONE_IN_USE: 'META_WHATSAPP_REGISTRATION_PHONE_IN_USE',
  WHATSAPP_REGISTRATION_PIN_MISMATCH: 'META_WHATSAPP_REGISTRATION_PIN_MISMATCH',
  WHATSAPP_TWO_STEP_VERIFICATION_REQUIRED:
    'META_WHATSAPP_TWO_STEP_VERIFICATION_REQUIRED',
  IG_NOT_AUTHORIZED_ADS: 'META_IG_NOT_AUTHORIZED_ADS',
  PAGE_NOT_LINKED_IG: 'META_PAGE_NOT_LINKED_IG',

  // Messaging
  MESSAGING_WINDOW_EXPIRED: 'META_MESSAGING_WINDOW_EXPIRED',
  MESSAGE_TOO_LONG: 'META_MESSAGE_TOO_LONG',
  USER_BLOCKED: 'META_USER_BLOCKED',
  RECIPIENT_NOT_FOUND: 'META_RECIPIENT_NOT_FOUND',
  SENDER_ACTION_FAILED: 'META_SENDER_ACTION_FAILED',
  RECIPIENT_UNAVAILABLE: 'META_RECIPIENT_UNAVAILABLE',
  CONVERSATION_NOT_FOUND: 'META_CONVERSATION_NOT_FOUND',
  OBJECT_NOT_ACCESSIBLE: 'META_OBJECT_NOT_ACCESSIBLE',
  IG_DM_DISABLED: 'META_IG_DM_DISABLED',
  MESSAGING_PERMISSION_DENIED: 'META_MESSAGING_PERMISSION_DENIED',

  // Rate limits
  RATE_LIMIT_APP: 'META_RATE_LIMIT_APP',
  RATE_LIMIT_USER: 'META_RATE_LIMIT_USER',
  RATE_LIMIT_PAGE: 'META_RATE_LIMIT_PAGE',
  RATE_LIMIT_ADS: 'META_RATE_LIMIT_ADS',

  // Content / Media
  MEDIA_TOO_LARGE: 'META_MEDIA_TOO_LARGE',
  MEDIA_UNSUPPORTED_FORMAT: 'META_MEDIA_UNSUPPORTED_FORMAT',
  MEDIA_INVALID_ASPECT_RATIO: 'META_MEDIA_INVALID_ASPECT_RATIO',
  MEDIA_NOT_READY: 'META_MEDIA_NOT_READY',
  CAPTION_TOO_LONG: 'META_CAPTION_TOO_LONG',
  DAILY_PUBLISH_LIMIT: 'META_DAILY_PUBLISH_LIMIT',
  PAGE_POST_NO_AD_IMAGE: 'META_PAGE_POST_NO_AD_IMAGE',

  // Permissions
  PERMISSION_PAGES_MESSAGING: 'META_PERMISSION_PAGES_MESSAGING',
  PERMISSION_GENERIC: 'META_PERMISSION_GENERIC',

  // Temporary blocks
  TEMPORARILY_BLOCKED: 'META_TEMPORARILY_BLOCKED',

  // Transient
  TRANSIENT_ERROR: 'META_TRANSIENT_ERROR',
  SERVICE_UNAVAILABLE: 'META_SERVICE_UNAVAILABLE',

  // Generic fallback
  UNKNOWN: 'META_UNKNOWN_ERROR',
} as const;

export type MetaErrorKey = (typeof MetaErrorKeys)[keyof typeof MetaErrorKeys];

// ---------------------------------------------------------------------------
// Registry entries
// ---------------------------------------------------------------------------

/**
 * Lookup key: `${code}` or `${code}:${subcode}`.
 * More specific (code:subcode) entries take precedence over code-only entries.
 */
const registry = new Map<string, MetaErrorInfo>();

function register(
  codes: Array<{ code: number; subcode?: number }>,
  info: MetaErrorInfo
) {
  for (const { code, subcode } of codes) {
    const key = subcode !== undefined ? `${code}:${subcode}` : `${code}`;
    registry.set(key, info);
  }
}

// ── Auth errors ────────────────────────────────────────────────────────────

register([{ code: 190, subcode: 463 }], {
  errorKey: MetaErrorKeys.AUTH_TOKEN_EXPIRED,
  category: 'auth_required',
  userTitle: 'Meta Connection Expired',
  userMessage:
    'Your Meta access token has expired. Please reconnect your Meta account to continue.',
  actionLabel: 'Reconnect',
  retryable: false,
  videoGuideSlug: 'reconnect-meta',
});

register(
  [
    { code: 190, subcode: 467 },
    { code: 190, subcode: 460 },
  ],
  {
    errorKey: MetaErrorKeys.AUTH_TOKEN_REVOKED,
    category: 'auth_required',
    userTitle: 'Meta Access Revoked',
    userMessage:
      'Your Meta access token has been revoked. This can happen if you changed your password or removed the app. Please reconnect.',
    actionLabel: 'Reconnect',
    retryable: false,
    videoGuideSlug: 'reconnect-meta',
  }
);

register([{ code: 190, subcode: 458 }], {
  errorKey: MetaErrorKeys.AUTH_APP_REMOVED,
  category: 'auth_required',
  userTitle: 'App Disconnected',
  userMessage:
    'You have removed the app from your Facebook account. Please reconnect to continue.',
  actionLabel: 'Reconnect',
  retryable: false,
  videoGuideSlug: 'reconnect-meta',
});

register([{ code: 102 }], {
  errorKey: MetaErrorKeys.AUTH_SESSION_EXPIRED,
  category: 'auth_required',
  userTitle: 'Session Expired',
  userMessage:
    'Your Meta session has expired. Please reconnect your Meta account.',
  actionLabel: 'Reconnect',
  retryable: false,
  videoGuideSlug: 'reconnect-meta',
});

// Fallback for code 190 without a recognized subcode.
// Code 190 always means "Invalid OAuth 2.0 Access Token" — the token is
// invalid regardless of the specific subcode. Subcodes that need different
// handling (459 checkpoint, 464 unconfirmed, etc.) have their own entries
// which take precedence. Any unrecognized subcode should trigger reconnect.
register([{ code: 190 }], {
  errorKey: MetaErrorKeys.AUTH_PASSWORD_CHANGED,
  category: 'auth_required',
  userTitle: 'Meta Connection Invalid',
  userMessage:
    'Your Meta connection is no longer valid. Please reconnect your Meta account.',
  actionLabel: 'Reconnect',
  retryable: false,
  videoGuideSlug: 'reconnect-meta',
});

// ── User action required ───────────────────────────────────────────────────

register([{ code: 190, subcode: 459 }], {
  errorKey: MetaErrorKeys.USER_CHECKPOINT,
  category: 'user_action_required',
  userTitle: 'Facebook Verification Needed',
  userMessage:
    'Facebook has flagged your account for security verification. Please log into facebook.com, complete the verification, and then try again.',
  actionUrl: 'https://www.facebook.com/checkpoint/',
  actionLabel: 'Go to Facebook',
  retryable: false,
  videoGuideSlug: 'facebook-checkpoint',
});

register([{ code: 190, subcode: 464 }], {
  errorKey: MetaErrorKeys.USER_UNCONFIRMED,
  category: 'user_action_required',
  userTitle: 'Facebook Account Unconfirmed',
  userMessage:
    'Your Facebook account has not been confirmed. Please log into facebook.com and confirm your account.',
  actionUrl: 'https://www.facebook.com/',
  actionLabel: 'Go to Facebook',
  retryable: false,
});

register([{ code: 190, subcode: 490 }], {
  errorKey: MetaErrorKeys.USER_ACCOUNT_FLAGGED,
  category: 'user_action_required',
  userTitle: 'Account Flagged',
  userMessage:
    'Your Facebook account has been flagged for suspicious activity. Please check your Meta Business Manager for any alerts or required actions.',
  actionUrl: 'https://business.facebook.com/settings/security',
  actionLabel: 'Check Business Manager',
  retryable: false,
  videoGuideSlug: 'account-flagged',
});

register([{ code: 190, subcode: 492 }], {
  errorKey: MetaErrorKeys.USER_MISSING_PAGE_ROLE,
  category: 'user_action_required',
  userTitle: 'Page Access Required',
  userMessage:
    'You do not have the required role on this Facebook Page. Ask a Page admin to grant you the appropriate permissions.',
  actionUrl: 'https://business.facebook.com/settings/pages',
  actionLabel: 'Check Page Settings',
  retryable: false,
  videoGuideSlug: 'page-roles',
});

// ── TOS / Policy ───────────────────────────────────────────────────────────

register([{ code: 100, subcode: 1815089 }], {
  errorKey: MetaErrorKeys.TOS_LEAD_GEN,
  category: 'user_action_required',
  userTitle: 'Accept Lead Ads Terms',
  userMessage:
    'Your Facebook Page must accept the Lead Generation Terms of Service before running lead ads. This is a one-time step required by Meta.',
  actionUrl: 'https://www.facebook.com/legal/leadgen/tos/',
  actionLabel: 'Accept Terms of Service',
  retryable: false,
  videoGuideSlug: 'lead-gen-tos',
});

// Non-discrimination certification required before running ads (Fixes API-1Y)
register([{ code: 3, subcode: 2859002 }], {
  errorKey: MetaErrorKeys.TOS_NONDISCRIMINATION,
  category: 'user_action_required',
  userTitle: 'Non-Discrimination Certification Required',
  userMessage:
    "You must certify compliance with Meta's Non-Discrimination Policy before running ads. This is a one-time step required by Meta.",
  actionUrl: 'https://www.facebook.com/certification/nondiscrimination',
  actionLabel: 'Complete Certification',
  retryable: false,
});

register([{ code: 200, subcode: 1870034 }], {
  errorKey: MetaErrorKeys.TOS_CUSTOM_AUDIENCE,
  category: 'user_action_required',
  userTitle: 'Accept Custom Audience Terms',
  userMessage:
    'You need to accept the Custom Audience Terms of Service in Meta Business Manager before using this feature.',
  actionUrl: 'https://business.facebook.com/ads/manage/customaudiences/tos/',
  actionLabel: 'Accept Terms',
  retryable: false,
  videoGuideSlug: 'custom-audience-tos',
});

register([{ code: 368 }], {
  errorKey: MetaErrorKeys.POLICY_VIOLATION,
  category: 'account_restricted',
  userTitle: 'Temporarily Blocked by Meta',
  userMessage:
    'Meta has temporarily blocked this action due to a policy violation. Review your account in Meta Business Manager for details on what needs to be fixed.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
  videoGuideSlug: 'policy-violation',
});

register([{ code: 500 }], {
  errorKey: MetaErrorKeys.CONTENT_BANNED,
  category: 'content_error',
  userTitle: 'Content Violates Policies',
  userMessage:
    "Your content has been flagged as violating Meta's advertising or community policies. Please review and modify the content.",
  actionUrl: 'https://www.facebook.com/policies/ads/',
  actionLabel: 'View Ad Policies',
  retryable: false,
});

// ── Permission errors ──────────────────────────────────────────────────────

register(
  [
    { code: 200, subcode: 2018028 },
    { code: 200, subcode: 1545041 },
  ],
  {
    errorKey: MetaErrorKeys.PERMISSION_PAGES_MESSAGING,
    category: 'permission_denied',
    userTitle: 'Messaging Permission Required',
    userMessage:
      'The app needs the pages_messaging permission to send messages. Please ensure the app has been reviewed and approved for this permission.',
    retryable: false,
  }
);

// Meta uses code 200 for its generic "Permissions error" response when no
// operation-specific subcode is supplied. Code 10 is the equivalent generic
// permission response on other Graph endpoints. Keep both at this code-only
// fallback level: the lookup prefers the more helpful code/subcode entries
// above (and the specific code 10 overrides below).
register([{ code: 10 }, { code: 200 }], {
  errorKey: MetaErrorKeys.PERMISSION_GENERIC,
  category: 'permission_denied',
  userTitle: 'Permission Denied',
  userMessage:
    'The app does not have the required permissions to perform this action. Please reconnect your account and ensure all permissions are granted.',
  actionLabel: 'Reconnect',
  retryable: false,
});

// Override code 10 for temporary account blocks (Fixes API-1H)
register([{ code: 10, subcode: 2859015 }], {
  errorKey: MetaErrorKeys.TEMPORARILY_BLOCKED,
  category: 'rate_limited',
  userTitle: 'Temporarily Blocked',
  userMessage:
    'Meta has temporarily restricted this action on your account. Please wait a few minutes and try again.',
  retryable: true,
});

// Override code 10 for customer's advertising permission being revoked
// (ENG-31). Comes through as code 10 / subcode 1404163 — "you can no longer
// use Meta technologies to advertise". The bare {code: 1404163} entry below
// also maps this, but live errors arrive as code 10 + this subcode, which
// would otherwise fall through to PERMISSION_GENERIC.
register([{ code: 10, subcode: 1404163 }], {
  errorKey: MetaErrorKeys.ADS_ACCESS_REVOKED,
  category: 'account_restricted',
  userTitle: 'Advertising Access Revoked',
  userMessage:
    'Meta has removed your permission to advertise. You cannot run ads, manage ad assets, or create ad accounts until this is resolved. Review your account status in Meta Business Manager.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
  videoGuideSlug: 'ads-access-revoked',
});

// Override code 10 for messaging window subcodes
register(
  [
    { code: 10, subcode: 2534022 },
    { code: 10, subcode: 2018278 },
    { code: 10, subcode: 2018065 },
    { code: 10, subcode: 2018108 },
  ],
  {
    errorKey: MetaErrorKeys.MESSAGING_WINDOW_EXPIRED,
    category: 'messaging_window',
    userTitle: 'Messaging Window Closed',
    userMessage:
      "You can only send messages within 24 hours of the customer's last message. Wait for the customer to message you again before replying.",
    retryable: false,
  }
);

// ── Rate limiting ──────────────────────────────────────────────────────────

register([{ code: 4 }], {
  errorKey: MetaErrorKeys.RATE_LIMIT_APP,
  category: 'rate_limited',
  userTitle: 'Too Many Requests',
  userMessage:
    "The app has reached Meta's rate limit. Please wait a few minutes and try again.",
  retryable: true,
});

register([{ code: 17 }], {
  errorKey: MetaErrorKeys.RATE_LIMIT_USER,
  category: 'rate_limited',
  userTitle: 'Too Many Requests',
  userMessage:
    "You've made too many requests to Meta. Please wait a moment and try again.",
  retryable: true,
});

register([{ code: 32 }], {
  errorKey: MetaErrorKeys.RATE_LIMIT_PAGE,
  category: 'rate_limited',
  userTitle: 'Page Rate Limit Reached',
  userMessage:
    'This Facebook Page has exceeded its API rate limit. Please wait a few minutes and try again.',
  retryable: true,
});

register([{ code: 341 }, { code: 613 }], {
  errorKey: MetaErrorKeys.RATE_LIMIT_ADS,
  category: 'rate_limited',
  userTitle: 'Rate Limit Reached',
  userMessage:
    'Too many requests have been made. Please wait a few minutes and try again.',
  retryable: true,
});

// ── Messaging ──────────────────────────────────────────────────────────────

register([{ code: 551 }], {
  errorKey: MetaErrorKeys.USER_BLOCKED,
  category: 'user_blocked',
  userTitle: 'User Blocked Messaging',
  userMessage:
    'This person has blocked messages from your business. You cannot message them until they unblock you.',
  retryable: false,
});

// (#551) "This person isn't available right now" — the recipient has
// restricted messaging or is otherwise unreachable (ENG-157). Distinct from a
// hard block; surface it as a recipient-side condition, not a server error.
register([{ code: 551, subcode: 1545041 }], {
  errorKey: MetaErrorKeys.RECIPIENT_UNAVAILABLE,
  category: 'user_blocked',
  userTitle: 'Recipient Unavailable',
  userMessage:
    "This person isn't available to receive messages right now. This usually means they've restricted who can message them.",
  retryable: false,
});

// (#100) Recipient cannot be resolved on the messaging platform — the PSID/IGSID
// no longer maps to a reachable user ("No matching user found", subcode 2018001
// — ENG-189). A recipient-side condition, not a bug, so it should not page as a
// 500.
register([{ code: 100, subcode: 2018001 }], {
  errorKey: MetaErrorKeys.RECIPIENT_NOT_FOUND,
  category: 'not_found',
  userTitle: 'Recipient Unavailable',
  userMessage:
    'This person could not be reached on the messaging platform. They may have deleted the conversation or are no longer reachable.',
  retryable: false,
});

// (#100) "Sender action failed" — Meta refused a `sender_action` (typing_on /
// typing_off / mark_seen). This was previously filed alongside 2018001 as
// `not_found`, which was wrong and actively harmful: callers took it to mean
// the recipient was unreachable and stopped delivering.
//
// It does NOT mean that. In the wave that began 2026-07-28, 10 of 21 recipients
// that produced this error received a message from the same Page within six
// hours — one of them 39 seconds later. The recipient is fine; only the
// cosmetic indicator was refused. Its own category keeps it out of every
// `not_found` / `user_blocked` branch, and `isExpected` keeps it at warn level
// so it doesn't trip infra error-rate alerts.
register([{ code: 100, subcode: 2018048 }], {
  errorKey: MetaErrorKeys.SENDER_ACTION_FAILED,
  category: 'sender_action_rejected',
  userTitle: 'Typing Indicator Rejected',
  userMessage:
    'Meta refused the typing indicator for this conversation. The message itself is unaffected.',
  retryable: false,
});

register([{ code: 100, subcode: 2534014 }], {
  errorKey: MetaErrorKeys.RECIPIENT_NOT_FOUND,
  category: 'not_found',
  userTitle: 'Recipient Not Found',
  userMessage: 'The Instagram user could not be found.',
  retryable: false,
});

register([{ code: 100, subcode: 2534038 }], {
  errorKey: MetaErrorKeys.MESSAGE_TOO_LONG,
  category: 'content_error',
  userTitle: 'Message Too Long',
  userMessage:
    'The message exceeds the Instagram DM character limit (1 000 characters). It has been automatically truncated for future sends.',
  retryable: false,
});

register([{ code: 100, subcode: 1772042 }], {
  errorKey: MetaErrorKeys.RECIPIENT_NOT_FOUND,
  category: 'not_found',
  userTitle: 'Invalid Instagram User ID',
  userMessage:
    'The Instagram user ID is not valid for this API call. This can happen when webhook-delivered IDs are used with the Conversations API.',
  retryable: false,
});

// Conversation was archived or deleted on Meta's side
register([{ code: 100, subcode: 2018365 }], {
  errorKey: MetaErrorKeys.CONVERSATION_NOT_FOUND,
  category: 'not_found',
  userTitle: 'Conversation Unavailable',
  userMessage:
    'This conversation has been archived or deleted on Meta and is no longer accessible.',
  retryable: false,
});

register([{ code: 100, subcode: 2534013 }], {
  errorKey: MetaErrorKeys.PAGE_NOT_LINKED_IG,
  category: 'user_action_required',
  userTitle: 'Page Not Linked to Instagram',
  userMessage:
    'Your Facebook Page is not linked to an Instagram Professional account. Go to your Page settings to connect an Instagram account.',
  actionUrl: 'https://business.facebook.com/settings/instagram',
  actionLabel: 'Link Instagram',
  retryable: false,
  videoGuideSlug: 'link-instagram-page',
});

register([{ code: 200, subcode: 2534041 }], {
  errorKey: MetaErrorKeys.IG_DM_DISABLED,
  category: 'user_action_required',
  userTitle: 'Instagram DMs Disabled',
  userMessage:
    'The Instagram account owner has disabled DM access for connected apps. The account owner must re-enable this in Instagram settings.',
  retryable: false,
});

register([{ code: 100, subcode: 2534029 }], {
  errorKey: MetaErrorKeys.ACCOUNT_RESTRICTED,
  category: 'account_restricted',
  userTitle: 'Instagram Messaging Blocked',
  userMessage:
    'Your business has been blocked from Instagram messaging due to policy violations. Review the violations in Meta Business Manager.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
  videoGuideSlug: 'policy-violation',
});

// WhatsApp messaging window
register([{ code: 131047 }], {
  errorKey: MetaErrorKeys.MESSAGING_WINDOW_EXPIRED,
  category: 'messaging_window',
  userTitle: 'WhatsApp Messaging Window Closed',
  userMessage:
    'More than 24 hours have passed since this customer last replied. Wait for them to message you again, or send an approved template message.',
  retryable: false,
});

// ── WhatsApp Cloud API runtime errors ─────────────────────────────────────
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/

// 131000 — Generic / unknown error from WhatsApp Cloud API
register([{ code: 131000 }], {
  errorKey: MetaErrorKeys.WHATSAPP_GENERIC_ERROR,
  category: 'transient',
  userTitle: 'WhatsApp Temporary Error',
  userMessage:
    'WhatsApp encountered a temporary error sending your message. Please try again in a few moments.',
  retryable: true,
});

// 131005 — Access denied
register([{ code: 131005 }], {
  errorKey: MetaErrorKeys.WHATSAPP_ACCESS_DENIED,
  category: 'permission_denied',
  userTitle: 'WhatsApp Access Denied',
  userMessage:
    'Your app does not have permission to perform this WhatsApp action. Reconnect your WhatsApp account or check your Meta Business permissions.',
  actionUrl:
    'https://business.facebook.com/settings/whatsapp-business-accounts',
  actionLabel: 'Open Business Settings',
  retryable: false,
});

// 131008 — Required parameter missing (real bug — log to Sentry)
register([{ code: 131008 }], {
  errorKey: MetaErrorKeys.WHATSAPP_REQUIRED_PARAMETER_MISSING,
  category: 'unknown',
  userTitle: 'WhatsApp Request Invalid',
  userMessage:
    'A required parameter was missing from the WhatsApp request. Our team has been notified.',
  retryable: false,
});

// 131016 — Service unavailable
register([{ code: 131016 }], {
  errorKey: MetaErrorKeys.WHATSAPP_SERVICE_UNAVAILABLE,
  category: 'transient',
  userTitle: 'WhatsApp Service Unavailable',
  userMessage:
    'WhatsApp Cloud API is temporarily unavailable. Please try again in a few minutes.',
  retryable: true,
});

// 131021 — Recipient cannot be sent to (not a valid WhatsApp user)
register([{ code: 131021 }], {
  errorKey: MetaErrorKeys.WHATSAPP_RECIPIENT_CANNOT_BE_SENT,
  category: 'user_action_required',
  userTitle: 'Recipient Not on WhatsApp',
  userMessage:
    'This phone number is not registered with WhatsApp, or messages cannot be delivered to it. Verify the number is correct and uses WhatsApp.',
  retryable: false,
});

// 131026 — Message undeliverable (recipient unable to receive)
register([{ code: 131026 }], {
  errorKey: MetaErrorKeys.WHATSAPP_MESSAGE_UNDELIVERABLE,
  category: 'content_error',
  userTitle: 'Message Undeliverable',
  userMessage:
    'WhatsApp could not deliver this message to the recipient. The recipient may have an outdated app version, be unreachable, or have blocked your business.',
  retryable: false,
});

// 131031 — Account locked
register([{ code: 131031 }], {
  errorKey: MetaErrorKeys.WHATSAPP_ACCOUNT_LOCKED,
  category: 'account_restricted',
  userTitle: 'WhatsApp Account Locked',
  userMessage:
    'Your WhatsApp Business account has been locked by Meta. Check your Business Manager for details and submit an appeal if applicable.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
});

// 131051 — Unsupported message type
register([{ code: 131051 }], {
  errorKey: MetaErrorKeys.WHATSAPP_UNSUPPORTED_MESSAGE_TYPE,
  category: 'content_error',
  userTitle: 'Unsupported Message Type',
  userMessage:
    'This message type is not supported by WhatsApp Cloud API. Use a supported type (text, template, image, etc.).',
  retryable: false,
});

// 131052 — Media download error
register([{ code: 131052 }], {
  errorKey: MetaErrorKeys.WHATSAPP_MEDIA_DOWNLOAD_ERROR,
  category: 'content_error',
  userTitle: 'WhatsApp Media Error',
  userMessage:
    'WhatsApp could not download or process the media you tried to send. Verify the file is valid and reachable.',
  retryable: false,
});

// 130429 — Rate limit hit
register([{ code: 130429 }], {
  errorKey: MetaErrorKeys.WHATSAPP_RATE_LIMIT,
  category: 'rate_limited',
  userTitle: 'WhatsApp Rate Limit Reached',
  userMessage:
    "WhatsApp's rate limit has been reached. Please wait a few minutes and try again.",
  retryable: true,
});

// 131048 — Spam rate limit (per-recipient throttling)
register([{ code: 131048 }], {
  errorKey: MetaErrorKeys.WHATSAPP_RATE_LIMIT,
  category: 'rate_limited',
  userTitle: 'WhatsApp Spam Rate Limit',
  userMessage:
    'WhatsApp is throttling messages to this recipient to prevent spam. Wait a few minutes and try again.',
  retryable: true,
});

// 131056 — Pair (business + recipient) rate limit
register([{ code: 131056 }], {
  errorKey: MetaErrorKeys.WHATSAPP_RATE_LIMIT,
  category: 'rate_limited',
  userTitle: 'WhatsApp Conversation Rate Limit',
  userMessage:
    'You have sent too many messages to this recipient in a short window. Please wait before sending again.',
  retryable: true,
});

// 131045 — Tier messaging limit reached (unverified businesses cap at 250/24h)
register([{ code: 131045 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TIER_LIMIT_REACHED,
  category: 'rate_limited',
  userTitle: 'WhatsApp Messaging Tier Limit',
  userMessage:
    'You have reached your WhatsApp messaging tier limit. Verify your business with Meta to unlock higher tiers.',
  actionUrl: 'https://business.facebook.com/settings/security',
  actionLabel: 'Verify Business',
  retryable: false,
  videoGuideSlug: 'business-verification',
});

// 132000 — Template parameter count mismatch
register([{ code: 132000 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TEMPLATE_PARAM_MISMATCH,
  category: 'content_error',
  userTitle: 'Template Parameter Mismatch',
  userMessage:
    "The number of parameters you supplied doesn't match what the template expects. Check the template definition and try again.",
  retryable: false,
});

// 132001 — Template does not exist for the given language
register([{ code: 132001 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TEMPLATE_NOT_FOUND,
  category: 'content_error',
  userTitle: 'WhatsApp Template Not Found',
  userMessage:
    'No template with that name exists for the chosen language. Verify the template name and language code.',
  retryable: false,
});

// 132005 — Translated template language not supported
register([{ code: 132005 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TEMPLATE_LANGUAGE_INVALID,
  category: 'content_error',
  userTitle: 'Template Language Invalid',
  userMessage:
    'The template translation for this language was not found. Either add the translation in WhatsApp Manager or use a supported language.',
  retryable: false,
});

// 132007 — Template paused due to low quality
register([{ code: 132007 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TEMPLATE_PAUSED,
  category: 'content_error',
  userTitle: 'WhatsApp Template Paused',
  userMessage:
    'This template has been paused by Meta due to quality issues. Edit the template content or wait for the pause to lift.',
  actionUrl: 'https://business.facebook.com/wa/manage/message-templates/',
  actionLabel: 'Open WhatsApp Manager',
  retryable: false,
});

// 132012 — Template disabled
register([{ code: 132012 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TEMPLATE_DISABLED,
  category: 'content_error',
  userTitle: 'WhatsApp Template Disabled',
  userMessage:
    'This template has been disabled by Meta and can no longer be sent. Create a new template instead.',
  actionUrl: 'https://business.facebook.com/wa/manage/message-templates/',
  actionLabel: 'Open WhatsApp Manager',
  retryable: false,
});

// 133000 — Incomplete account deletion
register([{ code: 133000 }], {
  errorKey: MetaErrorKeys.WHATSAPP_REGISTRATION_PHONE_IN_USE,
  category: 'user_action_required',
  userTitle: 'WhatsApp Registration Pending',
  userMessage:
    'A previous registration on this number is still being deleted. Please wait a few minutes and try again.',
  retryable: true,
});

// 133004 — Server temporarily unavailable
register([{ code: 133004 }], {
  errorKey: MetaErrorKeys.WHATSAPP_SERVICE_UNAVAILABLE,
  category: 'transient',
  userTitle: 'WhatsApp Registration Unavailable',
  userMessage:
    'WhatsApp registration is temporarily unavailable. Please try again in a few minutes.',
  retryable: true,
});

// 133005 — Two-step verification PIN mismatch
register([{ code: 133005 }], {
  errorKey: MetaErrorKeys.WHATSAPP_REGISTRATION_PIN_MISMATCH,
  category: 'user_action_required',
  userTitle: 'WhatsApp PIN Mismatch',
  userMessage:
    'The two-step verification PIN does not match the one set on this WhatsApp number. Verify the PIN and try again.',
  retryable: false,
});

// 133006 — Phone number re-verification needed
register([{ code: 133006 }], {
  errorKey: MetaErrorKeys.WHATSAPP_REGISTRATION_PHONE_IN_USE,
  category: 'user_action_required',
  userTitle: 'WhatsApp Re-verification Required',
  userMessage:
    'This phone number must be re-verified with WhatsApp before it can be used. Complete verification in WhatsApp Manager.',
  actionUrl:
    'https://business.facebook.com/settings/whatsapp-business-accounts',
  actionLabel: 'Open WhatsApp Manager',
  retryable: false,
});

// 133008 — Too many two-step verification attempts
register([{ code: 133008 }], {
  errorKey: MetaErrorKeys.WHATSAPP_TWO_STEP_VERIFICATION_REQUIRED,
  category: 'user_action_required',
  userTitle: 'Too Many Verification Attempts',
  userMessage:
    'Too many incorrect two-step verification attempts. Wait before trying again, or reset your WhatsApp PIN.',
  retryable: false,
});

// 133010 — Phone number not registered
register([{ code: 133010 }], {
  errorKey: MetaErrorKeys.WHATSAPP_REGISTRATION_PHONE_IN_USE,
  category: 'user_action_required',
  userTitle: 'Phone Not Registered',
  userMessage:
    'This phone number is not registered with the WhatsApp Cloud API. Complete the registration step before sending messages.',
  retryable: false,
});

// ── Content / Media ────────────────────────────────────────────────────────

register(
  [
    { code: 36000, subcode: 2207004 },
    { code: 100, subcode: 2018109 },
  ],
  {
    errorKey: MetaErrorKeys.MEDIA_TOO_LARGE,
    category: 'content_error',
    userTitle: 'File Too Large',
    userMessage:
      'The media file is too large. Images must be under 8 MB and videos must meet platform size limits.',
    retryable: false,
  }
);

register(
  [
    { code: 352, subcode: 2207026 },
    { code: 36001, subcode: 2207005 },
  ],
  {
    errorKey: MetaErrorKeys.MEDIA_UNSUPPORTED_FORMAT,
    category: 'content_error',
    userTitle: 'Unsupported File Format',
    userMessage:
      'This file format is not supported. Use JPEG or PNG for images, and MP4 or MOV for videos.',
    retryable: false,
  }
);

register([{ code: 36003, subcode: 2207009 }], {
  errorKey: MetaErrorKeys.MEDIA_INVALID_ASPECT_RATIO,
  category: 'content_error',
  userTitle: 'Invalid Aspect Ratio',
  userMessage:
    'The image or video has an unsupported aspect ratio. Use between 4:5 (portrait) and 1.91:1 (landscape).',
  retryable: false,
});

// Instagram is still transcoding the uploaded media container. This is a
// "come back in a moment", not a failure — Meta returns it while the video
// finishes processing on their side. Categorised `transient` so it is retried
// rather than surfaced, and so `beforeSend` keeps it out of Sentry (it was
// filing a Linear ticket per occurrence — ENG-637).
register([{ code: 9007, subcode: 2207027 }], {
  errorKey: MetaErrorKeys.MEDIA_NOT_READY,
  category: 'transient',
  userTitle: 'Still Processing',
  userMessage:
    'The video is still being processed. This usually takes a minute — we will keep trying.',
  retryable: true,
});

register([{ code: 36004, subcode: 2207010 }], {
  errorKey: MetaErrorKeys.CAPTION_TOO_LONG,
  category: 'content_error',
  userTitle: 'Caption Too Long',
  userMessage: 'Your caption exceeds 2,200 characters. Please shorten it.',
  retryable: false,
});

// Page post selected for an ad has no ad-usable image (ENG-369, code 324 /
// 2069019). The post itself is fine organically, but Meta can't build an ad
// creative from it. User-actionable: pick a different post or add an image.
register([{ code: 324, subcode: 2069019 }], {
  errorKey: MetaErrorKeys.PAGE_POST_NO_AD_IMAGE,
  category: 'content_error',
  userTitle: 'Post Has No Usable Image',
  userMessage:
    'Make sure the Page post you selected includes an image that can be used in an ad. Choose a post with a clear image, or add one to the post.',
  retryable: false,
});

register([{ code: 9, subcode: 2207042 }], {
  errorKey: MetaErrorKeys.DAILY_PUBLISH_LIMIT,
  category: 'rate_limited',
  userTitle: 'Daily Publishing Limit',
  userMessage:
    "You've reached Instagram's daily content publishing limit. Please try again tomorrow.",
  retryable: true,
});

// ── Account restrictions ───────────────────────────────────────────────────

register([{ code: 25, subcode: 2207050 }], {
  errorKey: MetaErrorKeys.IG_ACCOUNT_RESTRICTED,
  category: 'user_action_required',
  userTitle: 'Instagram Account Restricted',
  userMessage:
    'Your Instagram account is restricted. Please sign into the Instagram app on your phone to resolve any pending issues.',
  actionUrl: 'https://www.instagram.com/',
  actionLabel: 'Go to Instagram',
  retryable: false,
  videoGuideSlug: 'ig-account-restricted',
});

// ── Payment ───────────────────────────────────────────────────────────────

register([{ code: 100, subcode: 1359188 }], {
  errorKey: MetaErrorKeys.PAYMENT_METHOD_REQUIRED,
  category: 'payment_required',
  userTitle: 'Payment Method Required',
  userMessage:
    'Your Meta Ad Account does not have a valid payment method. Add a payment method in Meta Business Manager before launching ads.',
  actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
  actionLabel: 'Go to Meta Billing',
  retryable: false,
  videoGuideSlug: 'add-payment-method',
});

// ── DSA / Ad Transparency ─────────────────────────────────────────────────

register([{ code: 100, subcode: 3858081 }], {
  errorKey: MetaErrorKeys.DSA_BENEFICIARY_REQUIRED,
  category: 'user_action_required',
  userTitle: 'Ad Beneficiary Required',
  userMessage:
    'Meta requires you to specify who benefits from and pays for your ads. This is an EU transparency requirement (DSA). Please set this up in your Meta Ad Account settings.',
  actionUrl: 'https://www.facebook.com/business/help/605021638170961/',
  actionLabel: 'Learn More',
  retryable: false,
});

// ── Not found ──────────────────────────────────────────────────────────────

register([{ code: 100, subcode: 33 }], {
  errorKey: MetaErrorKeys.RECIPIENT_NOT_FOUND,
  category: 'not_found',
  userTitle: 'Object Not Found',
  userMessage: 'The requested object does not exist on Meta.',
  retryable: false,
});

// ── Transient ──────────────────────────────────────────────────────────────

register([{ code: 1 }, { code: 2 }], {
  errorKey: MetaErrorKeys.TRANSIENT_ERROR,
  category: 'transient',
  userTitle: 'Temporary Error',
  userMessage:
    'Meta is experiencing a temporary issue. Please try again in a few minutes.',
  retryable: true,
});

// ── Marketing API specific ─────────────────────────────────────────────────

register([{ code: 1404163 }], {
  errorKey: MetaErrorKeys.ADS_ACCESS_REVOKED,
  category: 'account_restricted',
  userTitle: 'Advertising Access Revoked',
  userMessage:
    'Your ad account has been disabled by Meta. Review your account status in Meta Business Manager and submit an appeal if applicable.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
  videoGuideSlug: 'ads-access-revoked',
});

register([{ code: 1815199 }], {
  errorKey: MetaErrorKeys.IG_NOT_AUTHORIZED_ADS,
  category: 'user_action_required',
  userTitle: 'Instagram Not Authorized for Ads',
  userMessage:
    'Your ad account does not have access to the Instagram account. Go to Meta Business Manager → Business Settings → Instagram Accounts to authorize it.',
  actionUrl: 'https://business.facebook.com/settings/instagram',
  actionLabel: 'Authorize Instagram',
  retryable: false,
  videoGuideSlug: 'authorize-ig-ads',
});

register([{ code: 1885272 }], {
  errorKey: MetaErrorKeys.BUDGET_TOO_LOW,
  category: 'user_action_required',
  userTitle: 'Budget Too Low',
  userMessage:
    "Your campaign budget is below Meta's minimum. Please increase the daily budget.",
  retryable: false,
});

register([{ code: 1487564 }], {
  errorKey: MetaErrorKeys.AD_ACCOUNT_DISABLED,
  category: 'account_restricted',
  userTitle: 'Ad Account Disabled',
  userMessage:
    'Your ad account has been disabled by Meta. This usually happens due to policy violations or outstanding payments. Check your Account Quality page for details and submit an appeal if applicable.',
  actionUrl: 'https://business.facebook.com/accountquality',
  actionLabel: 'Check Account Quality',
  retryable: false,
  videoGuideSlug: 'check-account-quality',
});

register([{ code: 1902136 }], {
  errorKey: MetaErrorKeys.BUSINESS_VERIFICATION_REQUIRED,
  category: 'user_action_required',
  userTitle: 'Business Verification Required',
  userMessage:
    'Meta requires you to verify your business identity before running ads. Complete the verification process in Meta Business Settings.',
  actionUrl: 'https://business.facebook.com/settings/security',
  actionLabel: 'Start Verification',
  retryable: false,
  videoGuideSlug: 'business-verification',
});

// Personal (non-Business) WhatsApp number linked to the Page (ENG-224). Meta
// rejects click-to-WhatsApp ads against a personal account.
register([{ code: 100, subcode: 2446885 }], {
  errorKey: MetaErrorKeys.WHATSAPP_PERSONAL_ACCOUNT,
  category: 'user_action_required',
  userTitle: 'Personal WhatsApp Number Linked',
  userMessage:
    'The WhatsApp number linked to your Page is a personal account. Connect a WhatsApp Business account to drive traffic to WhatsApp.',
  actionUrl:
    'https://business.facebook.com/settings/whatsapp-business-accounts',
  actionLabel: 'Connect WhatsApp Business',
  retryable: false,
  videoGuideSlug: 'connect-whatsapp',
});

register([{ code: 2446880 }], {
  errorKey: MetaErrorKeys.WHATSAPP_DISCONNECTED,
  category: 'user_action_required',
  userTitle: 'WhatsApp Not Connected',
  userMessage:
    'Your WhatsApp Business account is not connected to your Meta ad account. Connect it in Meta Business Manager before running WhatsApp ads.',
  actionUrl:
    'https://business.facebook.com/settings/whatsapp-business-accounts',
  actionLabel: 'Connect WhatsApp',
  retryable: false,
  videoGuideSlug: 'connect-whatsapp',
});

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Look up structured error info from Meta error code + subcode.
 * Returns undefined if no registry entry matches.
 *
 * Precedence: code:subcode > code-only > message-pattern fallback
 */
export function lookupMetaError(
  code?: number,
  subcode?: number,
  message?: string
): MetaErrorInfo | undefined {
  // Try most specific first: code + subcode
  if (code !== undefined && subcode !== undefined) {
    const specific = registry.get(`${code}:${subcode}`);
    if (specific) return specific;
  }

  // Try code only
  if (code !== undefined) {
    const codeOnly = registry.get(`${code}`);
    if (codeOnly) return codeOnly;
  }

  // Fall back to message-pattern matching for unregistered codes
  if (message) {
    return matchByMessage(message);
  }

  return undefined;
}

/**
 * Get all registered error keys (useful for frontend to preload video guides).
 */
export function getRegisteredVideoSlugs(): string[] {
  const slugs = new Set<string>();
  for (const info of registry.values()) {
    if (info.videoGuideSlug) slugs.add(info.videoGuideSlug);
  }
  return [...slugs];
}

// ---------------------------------------------------------------------------
// Message-pattern fallbacks for errors not caught by code
// ---------------------------------------------------------------------------

/** Message patterns for errors that come from Meta without standard codes */
const messagePatterns: Array<{
  pattern: RegExp;
  info: MetaErrorInfo;
}> = [
  {
    pattern: /payment method/i,
    info: {
      errorKey: MetaErrorKeys.PAYMENT_METHOD_REQUIRED,
      category: 'payment_required',
      userTitle: 'Payment Method Required',
      userMessage:
        'Your Meta Ad Account does not have a valid payment method. Add a payment method in Meta Business Manager before launching ads.',
      actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
      actionLabel: 'Go to Meta Billing',
      retryable: false,
      videoGuideSlug: 'add-payment-method',
    },
  },
  {
    pattern: /Lead Generation Terms of Service/i,
    info: {
      errorKey: MetaErrorKeys.TOS_LEAD_GEN,
      category: 'user_action_required',
      userTitle: 'Accept Lead Ads Terms',
      userMessage:
        'Your Facebook Page must accept the Lead Generation Terms of Service before running lead ads. This is a one-time step required by Meta.',
      actionUrl: 'https://www.facebook.com/legal/leadgen/tos/',
      actionLabel: 'Accept Terms of Service',
      retryable: false,
      videoGuideSlug: 'lead-gen-tos',
    },
  },
  {
    pattern:
      /benefitting from the ads|beneficiary.*ads|person or organisation/i,
    info: {
      errorKey: MetaErrorKeys.DSA_BENEFICIARY_REQUIRED,
      category: 'user_action_required',
      userTitle: 'Ad Beneficiary Required',
      userMessage:
        'Meta requires you to specify who benefits from and pays for your ads. This is an EU transparency requirement (DSA). Please set this up in your Meta Ad Account settings.',
      actionUrl: 'https://www.facebook.com/business/help/605021638170961/',
      actionLabel: 'Learn More',
      retryable: false,
    },
  },
  {
    pattern: /not linked to a WhatsApp account/i,
    info: {
      errorKey: MetaErrorKeys.WHATSAPP_DISCONNECTED,
      category: 'user_action_required',
      userTitle: 'WhatsApp Not Connected',
      userMessage:
        'Your Facebook Page is not linked to a WhatsApp Business Account. Go to Meta Business Manager → Business Settings → WhatsApp Accounts → Connected Assets → add your Facebook Page.',
      actionUrl:
        'https://business.facebook.com/settings/whatsapp-business-accounts',
      actionLabel: 'Connect WhatsApp',
      retryable: false,
      videoGuideSlug: 'connect-whatsapp',
    },
  },
  {
    pattern: /WhatsApp phone number is not linked/i,
    info: {
      errorKey: MetaErrorKeys.WHATSAPP_PHONE_NOT_LINKED,
      category: 'user_action_required',
      userTitle: 'WhatsApp Phone Not Linked',
      userMessage:
        'Your WhatsApp phone number is not linked to your Meta Ad Account. In Meta Business Manager → Business Settings → WhatsApp Accounts, make sure your WhatsApp Business Account is added and your Facebook Page is listed under Connected Assets.',
      actionUrl:
        'https://business.facebook.com/settings/whatsapp-business-accounts',
      actionLabel: 'Check WhatsApp Settings',
      retryable: false,
      videoGuideSlug: 'connect-whatsapp',
    },
  },
  {
    pattern: /spending limit/i,
    info: {
      errorKey: MetaErrorKeys.SPENDING_LIMIT_REACHED,
      category: 'payment_required',
      userTitle: 'Spending Limit Reached',
      userMessage:
        'Your ad account has reached its spending limit. Increase or remove the spending limit in Meta Business Settings to continue running ads.',
      actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
      actionLabel: 'Go to Billing Settings',
      retryable: false,
      videoGuideSlug: 'increase-spending-limit',
    },
  },
  {
    pattern: /card.*declined|payment.*failed|billing.*error|charge.*failed/i,
    info: {
      errorKey: MetaErrorKeys.PAYMENT_DECLINED,
      category: 'payment_required',
      userTitle: 'Payment Method Declined',
      userMessage:
        'Your payment method was declined by Meta. Please update your billing information in Meta Business Manager with a valid payment method.',
      actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
      actionLabel: 'Update Payment Method',
      retryable: false,
      videoGuideSlug: 'add-payment-method',
    },
  },
  {
    pattern: /Ads Terms of Service|advertising terms/i,
    info: {
      errorKey: MetaErrorKeys.POLICY_VIOLATION,
      category: 'user_action_required',
      userTitle: 'Accept Advertising Terms',
      userMessage:
        "You need to accept Meta's Advertising Terms of Service before running ads.",
      actionUrl: 'https://www.facebook.com/ads/manage/tos/',
      actionLabel: 'Accept Terms',
      retryable: false,
    },
  },
  {
    pattern: /business.*verif|verify.*business|identity.*verification/i,
    info: {
      errorKey: MetaErrorKeys.BUSINESS_VERIFICATION_REQUIRED,
      category: 'user_action_required',
      userTitle: 'Business Verification Required',
      userMessage:
        'Meta requires you to verify your business identity before running ads. Complete the verification process in Meta Business Settings.',
      actionUrl: 'https://business.facebook.com/settings/security',
      actionLabel: 'Start Verification',
      retryable: false,
      videoGuideSlug: 'business-verification',
    },
  },
  {
    pattern: /appsecret_proof/i,
    info: {
      errorKey: MetaErrorKeys.AUTH_INVALID_APPSECRET,
      category: 'unknown',
      userTitle: 'Meta Configuration Issue',
      userMessage:
        'There is a configuration issue with the Meta API connection. Please contact support.',
      retryable: false,
    },
  },
  {
    pattern:
      /invalid oauth access token|cannot parse access token|session has been invalidated|access token has expired|error validating access token|because the user (?:logged out|changed their password)|\binvalid token\b/i,
    info: {
      errorKey: MetaErrorKeys.AUTH_TOKEN_EXPIRED,
      category: 'auth_required',
      userTitle: 'Meta Connection Expired',
      userMessage:
        'Your Meta connection is no longer valid. Please reconnect your Meta account.',
      actionLabel: 'Reconnect',
      retryable: false,
      videoGuideSlug: 'reconnect-meta',
    },
  },
  {
    // "(#100) Tried accessing nonexisting field (X)" / GraphMethodException
    // (ENG-370). Hit when a CTWA/CTM referral id doesn't resolve to an ad
    // object our token can read (e.g. cross-account or non-ad node), so the
    // field selection (effective_status, …) is invalid. It's an expected
    // "can't import this referral" condition — callers already proceed without
    // the internal ad id — so classify it as not_found to keep it out of Sentry.
    pattern:
      /nonexisting field|GraphMethodException|does not resolve to a valid/i,
    info: {
      errorKey: MetaErrorKeys.OBJECT_NOT_ACCESSIBLE,
      category: 'not_found',
      userTitle: 'Object Not Accessible',
      userMessage:
        'This Meta object could not be accessed. It may have been deleted or may belong to a different account.',
      retryable: false,
    },
  },
  {
    // Meta gateway/CDN 5xx responses come back as HTML, not JSON, so they have
    // no error code — parseMetaErrorResponse stamps the HTTP status + body into
    // the message. Without this they fall through to `unknown` and flood Sentry
    // (e.g. the /insights 502/504s during campaign-insights sync). They're
    // transient and safe to retry.
    pattern:
      /HTTP 50[0-9]|<!DOCTYPE html>|Bad Gateway|Gateway Time-?out|Service Unavailable|temporarily unavailable/i,
    info: {
      errorKey: MetaErrorKeys.SERVICE_UNAVAILABLE,
      category: 'transient',
      userTitle: 'Meta Temporarily Unavailable',
      userMessage:
        'Meta is temporarily unavailable. Please try again in a few minutes.',
      retryable: true,
    },
  },
];

function matchByMessage(message: string): MetaErrorInfo | undefined {
  for (const { pattern, info } of messagePatterns) {
    if (pattern.test(message)) return info;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers for dynamic URL construction
// ---------------------------------------------------------------------------

/**
 * Replace placeholders in an action URL with actual values.
 *
 * @example
 * resolveActionUrl('https://facebook.com/ads/leadgen/tos?page_id={pageId}', { pageId: '123' })
 * // → 'https://facebook.com/ads/leadgen/tos?page_id=123'
 */
export function resolveActionUrl(
  urlTemplate: string,
  params: Record<string, string>
): string {
  let url = urlTemplate;
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`{${key}}`, encodeURIComponent(value));
  }
  return url;
}
