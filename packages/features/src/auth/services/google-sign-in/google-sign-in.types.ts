/**
 * Google sign-in response - returns the redirect URL for OAuth flow
 */
export interface GoogleSignInResponse {
  url: string;
  redirect: boolean;
}

/**
 * Auth API interface for Google sign-in
 */
export interface GoogleSignInAuthApi {
  signInSocial: (options: {
    body: {
      provider: 'google';
      callbackURL?: string;
      errorCallbackURL?: string;
      newUserCallbackURL?: string;
    };
    asResponse: true;
  }) => Promise<Response>;
}
