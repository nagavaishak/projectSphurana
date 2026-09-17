/**
 * Instagram OAuth API response types
 */

/** Short-lived token response from Instagram OAuth */
export interface InstagramTokenResponse {
  access_token: string;
  user_id: number;
}

/** Long-lived token response from Instagram Graph API */
export interface InstagramLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Instagram user profile from Graph API */
export interface InstagramUserProfile {
  /** App-scoped user ID (unique per app, NOT used in webhooks) */
  id: string;
  /** Instagram-scoped user ID / IGBA (used by webhooks as recipient.id) */
  user_id: string;
  username: string;
  name: string;
  profile_picture_url?: string;
  account_type: string;
}

/** Credentials stored in encrypted form */
export interface InstagramCredentials {
  accessToken: string;
  instagramUserId: string;
}
