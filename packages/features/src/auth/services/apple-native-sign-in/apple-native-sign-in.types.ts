/**
 * Apple native sign-in response - same shape as sign-in
 */
export interface AppleNativeSignInResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    token: string;
  };
}

/**
 * Auth API interface for Apple native sign-in
 */
export interface AppleNativeSignInAuthApi {
  signInSocial: (options: {
    body: {
      provider: 'apple';
      idToken: {
        token: string;
        nonce?: string;
        accessToken?: string;
      };
    };
    asResponse: true;
  }) => Promise<Response>;
}
