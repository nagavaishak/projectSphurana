// Auth feature barrel export

// Services
export {
  // sign-up
  signUp,
  signUpSchema,
  type SignUpInput,
  type SignUpResult,
  type SignUpResponse,
  type SignUpAuthApi,
  // sign-in
  signIn,
  signInSchema,
  type SignInInput,
  type SignInResult,
  type SignInResponse,
  type SignInAuthApi,
  // sign-out
  signOut,
  signOutSchema,
  type SignOutInput,
  type SignOutResult,
  type SignOutResponse,
  type SignOutAuthApi,
  // get-session
  getSession,
  getSessionSchema,
  type GetSessionInput,
  type GetSessionResult,
  type SessionResponse,
  type GetSessionAuthApi,
  // verify-email
  verifyEmail,
  verifyEmailSchema,
  type VerifyEmailInput,
  type VerifyEmailResult,
  type VerifyEmailResponse,
  type VerifyEmailAuthApi,
  // resend-verification
  resendVerification,
  resendVerificationSchema,
  type ResendVerificationInput,
  type ResendVerificationResult,
  type ResendVerificationResponse,
  type ResendVerificationAuthApi,
  // create-api-key
  createApiKey,
  createApiKeySchema,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type CreateApiKeyResponse,
  type CreateApiKeyAuthApi,
  type ApiKeyMetadata,
  // verify-api-key
  verifyApiKey,
  verifyApiKeySchema,
  type VerifyApiKeyInput,
  type VerifyApiKeyResult,
  type VerifyApiKeyResponse,
  type VerifyApiKeyAuthApi,
  // google-sign-in
  googleSignIn,
  googleSignInSchema,
  type GoogleSignInInput,
  type GoogleSignInResult,
  type GoogleSignInResponse,
  type GoogleSignInAuthApi,
  // google-sign-up
  googleSignUp,
  googleSignUpSchema,
  type GoogleSignUpInput,
  type GoogleSignUpResult,
  type GoogleSignUpResponse,
  type GoogleSignUpAuthApi,
  // change-password
  changePassword,
  changePasswordSchema,
  type ChangePasswordInput,
  type ChangePasswordResult,
  type ChangePasswordResponse,
  type ChangePasswordAuthApi,
  // change-email
  changeEmail,
  changeEmailSchema,
  type ChangeEmailInput,
  type ChangeEmailResult,
  type ChangeEmailResponse,
  type ChangeEmailAuthApi,
  // apple-native-sign-in
  appleNativeSignIn,
  appleNativeSignInSchema,
  type AppleNativeSignInInput,
  type AppleNativeSignInResult,
  type AppleNativeSignInResponse,
  type AppleNativeSignInAuthApi,
  // invalidate-user-sessions
  invalidateUserSessions,
  invalidateUserSessionsSchema,
  type InvalidateUserSessionsInput,
  type InvalidateUserSessionsResult,
  type InvalidateUserSessionsResponse,
  type RedisLike,
  // clear-active-org-sessions
  clearActiveOrgSessions,
  clearActiveOrgSessionsSchema,
  type ClearActiveOrgSessionsInput,
  type ClearActiveOrgSessionsResult,
  type ClearActiveOrgSessionsResponse,
  // clear-session-secondary-storage-for-user
  clearSessionSecondaryStorageForUser,
  clearSessionSecondaryStorageForUserSchema,
  type ClearSessionSecondaryStorageForUserInput,
  type ClearSessionSecondaryStorageForUserResult,
  type ClearSessionSecondaryStorageForUserResponse,
  type SessionSecondaryStorageRedis,
  // forgot-password
  forgotPassword,
  forgotPasswordSchema,
  type ForgotPasswordInput,
  type ForgotPasswordResult,
  type ForgotPasswordResponse,
  type ForgotPasswordAuthApi,
  // reset-password
  resetPassword,
  resetPasswordSchema,
  type ResetPasswordInput,
  type ResetPasswordResult,
  type ResetPasswordResponse,
  type ResetPasswordAuthApi,
  // enable-two-factor
  enableTwoFactor,
  enableTwoFactorSchema,
  type EnableTwoFactorInput,
  type EnableTwoFactorResult,
  type EnableTwoFactorResponse,
  type EnableTwoFactorAuthApi,
  // verify-totp
  verifyTotp,
  verifyTotpSchema,
  type VerifyTotpInput,
  type VerifyTotpResult,
  type VerifyTotpResponse,
  type VerifyTotpAuthApi,
  // generate-intercom-jwt
  generateIntercomJwt,
} from './services/index.js';

// Cookie/header transport shared by the auth-adjacent services (and by the
// admin-terminal impersonation services, which speak the same Better Auth
// cookie protocol).
export {
  buildForwardedCookieHeaders,
  buildSessionCookieHeaders,
  buildSessionCookiePair,
  extractAdminSessionCookiePair,
  extractSessionTokenFromSetCookies,
  readSetCookieHeaders,
} from './shared/index.js';
