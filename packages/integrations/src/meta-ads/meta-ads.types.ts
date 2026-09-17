/**
 * Credentials stored for Meta Ads integration
 */
export interface MetaAdsCredentials {
  /** Long-lived access token */
  accessToken: string;
  /** Ad account ID (e.g., "act_123456789") */
  adAccountId: string;
  /** Facebook Page ID for ad creatives */
  pageId: string;
  /** Page name for display */
  pageName?: string;
  /** Token expiration timestamp */
  tokenExpiresAt?: number;
  /** Ad account currency code (ISO 4217, e.g., "USD", "EUR", "GBP") */
  adAccountCurrency?: string;
  /** Meta App Secret — used to generate appsecret_proof for server-to-server calls */
  appSecret?: string;
}

/**
 * Campaign configuration for Meta Marketing API
 */
export interface MetaCampaignConfig {
  name: string;
  objective:
    | 'OUTCOME_AWARENESS'
    | 'OUTCOME_ENGAGEMENT'
    | 'OUTCOME_LEADS'
    | 'OUTCOME_SALES'
    | 'OUTCOME_TRAFFIC';
  status: 'PAUSED' | 'ACTIVE';
  specialAdCategories?: string[];
  dailyBudget?: number; // in smallest currency unit (e.g., cents for USD/EUR)
  lifetimeBudget?: number; // in smallest currency unit (e.g., cents for USD/EUR)
}

/**
 * Ad Set configuration (auto-created, hidden from user)
 */
export interface MetaAdSetConfig {
  name: string;
  campaignId: string;
  status: 'PAUSED' | 'ACTIVE';
  billingEvent: 'IMPRESSIONS' | 'LINK_CLICKS' | 'VIDEO_VIEWS';
  optimizationGoal:
    | 'REACH'
    | 'IMPRESSIONS'
    | 'LINK_CLICKS'
    | 'VIDEO_VIEWS'
    | 'LANDING_PAGE_VIEWS'
    | 'LEAD_GENERATION'
    | 'CONVERSATIONS';
  targeting: MetaTargetingSpec;
  startTime?: string;
  endTime?: string;
  dailyBudget?: number;
  /** Bid amount in cents (required when using LOWEST_COST_WITH_BID_CAP) */
  bidAmount?: number;
  /** Bid strategy - defaults to LOWEST_COST_WITHOUT_CAP */
  bidStrategy?:
    | 'LOWEST_COST_WITHOUT_CAP'
    | 'LOWEST_COST_WITH_BID_CAP'
    | 'COST_CAP';
  /** Promoted object — required for most campaign objectives */
  promotedObject?: {
    pageId?: string;
    pixelId?: string;
    customEventType?: string;
    /** WhatsApp phone number (e.g., "+1234567890") — required for WhatsApp destination ads */
    whatsappPhoneNumber?: string;
  };
  /** Destination type — required for OUTCOME_* campaign objectives */
  destinationType?:
    | 'WEBSITE'
    | 'ON_AD'
    | 'APP'
    | 'MESSENGER'
    | 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP'
    | 'MESSAGING_MESSENGER_WHATSAPP'
    | 'WHATSAPP'
    | 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER'
    | 'INSTAGRAM_DIRECT'
    | 'PHONE_CALL';
  /** DSA beneficiary — EU ad transparency requirement (page ID or name) */
  dsaBeneficiary?: string;
  /** DSA payor — EU ad transparency requirement (page ID or name) */
  dsaPayor?: string;
}

/**
 * Targeting specification for ad sets
 */
export interface MetaTargetingSpec {
  geo_locations?: {
    countries?: string[];
    regions?: Array<{ key: string }>;
    cities?: Array<{
      key: string;
      radius?: number;
      distance_unit?: 'kilometer' | 'mile';
    }>;
    custom_locations?: Array<{
      latitude: number;
      longitude: number;
      radius: number;
      distance_unit?: 'kilometer' | 'mile';
    }>;
    /**
     * Who counts as "in" the location. Default is ['home','recent'] (people
     * living in OR recently in). ['home'] restricts to residents only and
     * suppresses Meta's "reach more people... interested in your selected
     * cities and regions" location expansion.
     */
    location_types?: Array<'home' | 'recent' | 'travel_in'>;
  };
  age_min?: number;
  age_max?: number;
  genders?: number[]; // 1 = male, 2 = female
  locales?: number[];
  publisher_platforms?: Array<
    'facebook' | 'instagram' | 'audience_network' | 'messenger'
  >;
  facebook_positions?: string[];
  instagram_positions?: string[];
  targeting_automation?: {
    advantage_audience?: 0 | 1;
  };
}

/**
 * Degrees of freedom spec for Advantage+ Creative.
 * Required by Meta for multi-destination messaging ads (MESSAGING_INSTAGRAM_DIRECT_MESSENGER).
 * Controls what Meta is allowed to automatically optimize in the creative.
 * Note: standard_enhancements was deprecated — use individual feature opt-outs instead.
 */
export interface MetaCreativeFeatureEnrollment {
  enroll_status: 'OPT_IN' | 'OPT_OUT';
}

export interface MetaDegreesOfFreedomSpec {
  creative_features_spec: {
    [key: string]: MetaCreativeFeatureEnrollment;
  };
}

/**
 * Asset feed spec for multi-destination messaging ads.
 * Required alongside degrees_of_freedom_spec for MESSAGING_INSTAGRAM_DIRECT_MESSENGER ads.
 */
export interface MetaAssetFeedSpec {
  optimization_type: 'DOF_MESSAGING_DESTINATION';
  call_to_actions: Array<{
    type: MetaCallToActionType;
    value: {
      app_destination: string;
      link: string;
    };
  }>;
}

/**
 * Ad Creative configuration for video ads
 */
export interface MetaAdCreativeConfig {
  name: string;
  objectStorySpec: {
    pageId: string;
    instagramActorId?: string;
    videoData: {
      videoId: string; // Meta video ID (after upload)
      imageUrl?: string; // Thumbnail URL
      title?: string;
      message?: string;
      linkDescription?: string;
      callToAction?: {
        type: MetaCallToActionType;
        value: {
          link?: string;
          leadGenFormId?: string;
          appDestination?: string;
        };
      };
      /** Stringified JSON for messenger welcome message / ice breakers */
      pageWelcomeMessage?: string;
    };
  };
  /** Required for multi-destination messaging ads (MESSAGING_INSTAGRAM_DIRECT_MESSENGER) */
  degreesOfFreedomSpec?: MetaDegreesOfFreedomSpec;
  /** Required for multi-destination messaging ads — specifies CTAs per platform */
  assetFeedSpec?: MetaAssetFeedSpec;
}

/**
 * Ad Creative configuration for image ads (uses link_data instead of video_data)
 */
export interface MetaAdImageCreativeConfig {
  name: string;
  objectStorySpec: {
    pageId: string;
    instagramActorId?: string;
    linkData: {
      imageHash: string;
      message?: string;
      name?: string; // headline
      description?: string;
      link?: string; // destination URL
      callToAction?: {
        type: MetaCallToActionType;
        value?: {
          link?: string;
          /** Instant lead form id — REQUIRED for OUTCOME_LEADS image creatives. */
          leadGenFormId?: string;
          appDestination?: string;
        };
      };
    };
  };
  /** Required for multi-destination messaging ads (MESSAGING_INSTAGRAM_DIRECT_MESSENGER) */
  degreesOfFreedomSpec?: MetaDegreesOfFreedomSpec;
  /** Required for multi-destination messaging ads — specifies CTAs per platform */
  assetFeedSpec?: MetaAssetFeedSpec;
}

/**
 * Image upload result from Meta
 */
export interface MetaImageUploadResult {
  imageHash: string;
}

/**
 * Call to action types supported by Meta
 */
export type MetaCallToActionType =
  | 'LEARN_MORE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'CONTACT_US'
  | 'WATCH_MORE'
  | 'BOOK_NOW'
  | 'GET_QUOTE'
  | 'SUBSCRIBE'
  | 'DOWNLOAD'
  | 'GET_OFFER'
  | 'APPLY_NOW'
  | 'BUY_NOW'
  | 'GET_DIRECTIONS'
  | 'MESSAGE_PAGE'
  | 'SEND_MESSAGE'
  | 'WHATSAPP_MESSAGE'
  | 'INSTAGRAM_MESSAGE';

/**
 * Ad configuration
 */
export interface MetaAdConfig {
  name: string;
  adSetId: string;
  creativeId: string;
  status: 'PAUSED' | 'ACTIVE';
  /** Required for multi-destination messaging ads (MESSAGING_INSTAGRAM_DIRECT_MESSENGER) */
  degreesOfFreedomSpec?: MetaDegreesOfFreedomSpec;
  /** Required for multi-destination messaging ads — specifies CTAs per platform */
  assetFeedSpec?: MetaAssetFeedSpec;
}

/**
 * Video upload result from Meta
 */
export interface MetaVideoUploadResult {
  videoId: string;
  thumbnails?: Array<{ uri: string }>;
}

/**
 * Video status response
 */
export interface MetaVideoStatus {
  status: 'processing' | 'ready' | 'error';
  isReady: boolean;
  errorMessage?: string;
  thumbnailUrl?: string;
}

/**
 * Campaign data from Meta API
 */
export interface MetaCampaignData {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  createdTime?: string;
  updatedTime?: string;
}

/**
 * Ad Set data from Meta API
 */
export interface MetaAdSetData {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  campaignId: string;
  /**
   * Meta `destination_type` on the ad set (e.g. `WHATSAPP`,
   * `MESSAGING_MESSENGER_WHATSAPP`, `MESSAGING_INSTAGRAM_DIRECT_MESSENGER`).
   * Used by launch-ad to find or create an ad set matching an ad's
   * resolved destinations. Undefined when Meta doesn't return it for
   * an ad set (e.g. legacy ad sets without an explicit destination).
   */
  destinationType?: string;
}

/**
 * Ad data from Meta API
 */
export interface MetaAdData {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  createdTime?: string;
  updatedTime?: string;
  thumbnailUrl?: string;
  /** Permalink URL to the ad post on Facebook (from effective_object_story_id) */
  permalinkUrl?: string;
}

/**
 * Minimal ad fields needed to lazily import a single ad into `meta_ad` on a
 * CTM/CTWA referral miss. Unlike `getAd`, this carries the campaign + ad set
 * ids so the imported row is attributable to a campaign. See
 * docs/implementations/ctm-ad-lazy-import.md.
 */
export interface MetaAdImportFields {
  id: string;
  name: string;
  effectiveStatus: string;
  campaignId?: string;
  adSetId?: string;
}

/**
 * Ad data from Meta API with creative details (for importing)
 */
export interface MetaAdWithCreative extends MetaAdData {
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  creative?: {
    id: string;
    title?: string;
    body?: string;
    linkUrl?: string;
    callToActionType?: string;
    thumbnailUrl?: string;
    linkDescription?: string;
    videoId?: string;
  };
}

/**
 * Insights/metrics data from Meta API
 */
export interface MetaInsightsData {
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  frequency?: string;
  adId?: string;
  adName?: string;
  videoP25WatchedActions?: Array<{ actionType: string; value: string }>;
  videoP50WatchedActions?: Array<{ actionType: string; value: string }>;
  videoP75WatchedActions?: Array<{ actionType: string; value: string }>;
  videoP100WatchedActions?: Array<{ actionType: string; value: string }>;
  actions?: Array<{ actionType: string; value: string }>;
  dateStart?: string;
  dateStop?: string;
}

/**
 * Business info from Meta Business API
 */
export interface MetaBusinessInfo {
  id: string;
  name: string;
  profilePictureUri?: string;
}

/**
 * What `debug_token` says a pasted token actually is.
 *
 * `type` is the field the system-user flow turns on: Meta reports a system
 * user's token as `SYSTEM_USER` and a person's as `USER`, and only the former
 * survives the person who created it leaving the business.
 */
export interface MetaTokenDescription {
  isValid: boolean;
  /** The app that minted it — ours, or someone else's. */
  appId: string | null;
  /** `SYSTEM_USER`, `USER`, `PAGE`, … as Meta reports it. */
  type: string | null;
  /** Unix seconds, or null when the token never expires. */
  expiresAt: number | null;
  scopes: string[];
  /** Meta's own reason when the token is not valid. */
  error: string | null;
}

/**
 * An asset ASSIGNED to our system user, carrying the business that owns it.
 *
 * `businessId`/`businessName` come from the asset's `business` field rather
 * than from walking portfolios, because `/me/businesses` is empty for a system
 * user token. They are nullable: an asset can be assigned without the token
 * holding a task that lets it read the owning business.
 */
interface MetaAssignedAsset {
  id: string;
  businessId: string | null;
  businessName: string | null;
}

export interface MetaAssignedPage extends MetaAssignedAsset {
  name: string;
  category: string | null;
  pictureUrl: string | null;
  /**
   * What the system user may actually DO with this Page, e.g. `MANAGE_LEADS`.
   * A partner can only sub-delegate tasks it was granted, so this is narrower
   * than the token's scopes and is the real ceiling on capability.
   */
  tasks: string[];
  /** The Page's linked Instagram account, which rides on the same token. */
  instagram: {
    id: string;
    username: string;
    name: string;
    profilePictureUrl: string | null;
  } | null;
}

export interface MetaAssignedAdAccount extends MetaAssignedAsset {
  /** `act_123…` */
  accountId: string;
  name: string;
  currency: string | null;
}

export interface MetaAssignedWhatsAppAccount extends MetaAssignedAsset {
  name: string | null;
}

/**
 * OAuth user info response
 */
export interface MetaUserInfo {
  id: string;
  name: string;
  email?: string;
  pictureUrl?: string;
}

/**
 * Ad account info response
 */
/**
 * Meta ad account status codes
 * 1 = ACTIVE (can run ads)
 * 2 = DISABLED
 * 3 = UNSETTLED (unpaid balance)
 * 7 = PENDING_RISK_REVIEW
 * 8 = PENDING_SETTLEMENT
 * 9 = IN_GRACE_PERIOD
 * 100 = PENDING_CLOSURE
 * 101 = CLOSED
 */
export interface MetaAdAccountInfo {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  accountStatus: number;
  businessName?: string;
  /** Business ID this ad account belongs to */
  businessId?: string;
  /** Reason the account was disabled (0 = none, 1 = ads integrity, 2 = payment, etc.) */
  disableReason?: number;
  /** Whether the account has a payment method configured */
  hasPaymentMethod?: boolean;
}

/**
 * Page info response
 */
export interface MetaPageInfo {
  id: string;
  name: string;
  accessToken: string;
  category?: string;
  pictureUrl?: string;
  /** Business ID this page belongs to */
  businessId?: string;
  /** Instagram Business Account linked to this page (if any) */
  instagramBusinessAccount?: {
    id: string;
    name: string;
    username: string;
    profilePictureUrl?: string;
  };
}

/**
 * OAuth token response
 */
export interface MetaOAuthTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}

/**
 * Long-lived token response
 */
export interface MetaLongLivedTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number; // typically 60 days in seconds, but Meta API may omit this
}

// ==================== LEAD FORMS ====================

/**
 * Lead form field type
 */
export type MetaLeadFormFieldType =
  | 'EMAIL'
  | 'PHONE'
  | 'FULL_NAME'
  | 'FIRST_NAME'
  | 'LAST_NAME'
  | 'CITY'
  | 'STATE'
  | 'COUNTRY'
  | 'ZIP'
  | 'STREET_ADDRESS'
  | 'DATE_OF_BIRTH'
  | 'GENDER'
  | 'JOB_TITLE'
  | 'COMPANY_NAME'
  | 'WORK_EMAIL'
  | 'WORK_PHONE_NUMBER'
  | 'CUSTOM';

/**
 * Lead form question configuration
 */
export interface MetaLeadFormQuestion {
  /** Field type */
  type: MetaLeadFormFieldType;
  /** Custom label (optional, defaults to field type label) */
  label?: string;
  /** For CUSTOM type only - unique key for the field */
  key?: string;
  /** Options for select/dropdown fields */
  options?: Array<{ value: string; key?: string }>;
}

/**
 * Privacy policy configuration
 */
export interface MetaLeadFormPrivacyPolicy {
  /** URL to privacy policy */
  url: string;
  /** Text shown above the link */
  linkText?: string;
}

/**
 * Lead form configuration for creation
 */
export interface MetaLeadFormConfig {
  /** Form name (internal use) */
  name: string;
  /** Questions to ask in the form */
  questions: MetaLeadFormQuestion[];
  /** Privacy policy settings */
  privacyPolicy: MetaLeadFormPrivacyPolicy;
  /** Thank you screen settings */
  thankYouPage?: {
    /** Title shown after submission */
    title?: string;
    /** Body text */
    body?: string;
    /** Button text */
    buttonText?: string;
    /** Button URL (used when buttonType is VIEW_WEBSITE) */
    buttonUrl?: string;
    /**
     * Call-to-action button type on the post-submission screen.
     * Messaging types power instant-form lead nurturing.
     * Defaults to VIEW_WEBSITE when a buttonUrl is set, otherwise NONE.
     */
    buttonType?:
      | 'NONE'
      | 'VIEW_WEBSITE'
      | 'P2B_MESSENGER'
      | 'WHATSAPP'
      | 'CALL_BUSINESS';
    /** Business WhatsApp number (E.164), required when buttonType is WHATSAPP */
    businessPhoneNumber?: string;
    /**
     * Meta's "Start conversations on Messenger" ("Connect with leads in
     * Messenger") setting. When on, Meta opens a Messenger/Instagram thread
     * containing the lead's contact details as soon as they submit — the lead
     * does NOT have to tap the thank-you-page CTA. That inbound message is what
     * wakes the chatbot up, so this is the difference between reaching every
     * lead and only reaching the ~7% who tap the button.
     *
     * Meta defaults this to false. We default it to TRUE — see
     * `createLeadGenForm`. Only forms whose questions are Messenger-eligible
     * can carry it (see MESSENGER_ELIGIBLE_QUESTION_TYPES).
     */
    enableMessenger?: boolean;
  };
  /** Context card shown before questions */
  contextCard?: {
    /** Title */
    title?: string;
    /** Content/body text */
    content?: string;
    /** Button text */
    buttonText?: string;
    /** Style: paragraph_style or bullet_style */
    style?: 'PARAGRAPH_STYLE' | 'BULLET_STYLE';
  };
  /** Form locale */
  locale?: string;
  /** Follow up action type */
  followUpActionUrl?: string;
}

/**
 * Lead form data from Meta API
 */
export interface MetaLeadFormData {
  /** Form ID */
  id: string;
  /** Form name */
  name: string;
  /** Form status */
  status: string;
  /** Locale */
  locale?: string;
  /** Questions in the form */
  questions?: MetaLeadFormQuestion[];
  /** Lifetime lead total Meta reports on the `leadgen_forms` edge. */
  leadsCount?: number;
  /** Privacy policy link */
  privacyPolicyUrl?: string;
  /** Created time */
  createdTime?: string;
  /** Page ID this form belongs to */
  pageId?: string;
}

/**
 * Lead data submitted through a form
 */
export interface MetaLeadData {
  /** Lead ID */
  id: string;
  /** Form ID the lead came from */
  formId: string;
  /** Field data as key-value pairs */
  fieldData: Array<{
    name: string;
    /** Meta's webhook can omit `values` entirely for a field. */
    values?: string[];
  }>;
  /** Creation time */
  createdTime: string;
  /** Ad ID if from an ad */
  adId?: string;
  /** Campaign ID if from a campaign */
  campaignId?: string;
}
