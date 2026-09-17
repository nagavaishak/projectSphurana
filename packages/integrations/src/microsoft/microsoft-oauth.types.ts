/**
 * Microsoft OAuth token response
 */
export interface MicrosoftOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
}

/**
 * Microsoft user info from Graph API
 */
export interface MicrosoftUserInfo {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}
