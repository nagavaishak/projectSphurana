// Auth services barrel export

// sign-up
export {
  signUp,
  signUpSchema,
  type SignUpInput,
  type SignUpResult,
  type SignUpResponse,
  type SignUpAuthApi,
} from './sign-up/index.js';

// sign-in
export {
  signIn,
  signInSchema,
  type SignInInput,
  type SignInResult,
  type SignInResponse,
  type SignInAuthApi,
} from './sign-in/index.js';

// sign-out
export {
  signOut,
  signOutSchema,
  type SignOutInput,
  type SignOutResult,
  type SignOutResponse,
  type SignOutAuthApi,
} from './sign-out/index.js';

// get-session
export {
  getSession,
  getSessionSchema,
  type GetSessionInput,
  type GetSessionResult,
  type SessionResponse,
  type GetSessionAuthApi,
} from './get-session/index.js';

// verify-email
export {
  verifyEmail,
  verifyEmailSchema,
  type VerifyEmailInput,
  type VerifyEmailResult,
  type VerifyEmailResponse,
  type VerifyEmailAuthApi,
} from './verify-email/index.js';

// resend-verification
export {
  resendVerification,
  resendVerificationSchema,
  type ResendVerificationInput,
  type ResendVerificationResult,
  type ResendVerificationResponse,
  type ResendVerificationAuthApi,
} from './resend-verification/index.js';

// create-api-key
export {
  createApiKey,
  createApiKeySchema,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type CreateApiKeyResponse,
  type CreateApiKeyAuthApi,
  type ApiKeyMetadata,
} from './create-api-key/index.js';

// verify-api-key
export {
  verifyApiKey,
  verifyApiKeySchema,
  type VerifyApiKeyInput,
  type VerifyApiKeyResult,
  type VerifyApiKeyResponse,
  type VerifyApiKeyAuthApi,
} from './verify-api-key/index.js';

// google-sign-in
export {
  googleSignIn,
  googleSignInSchema,
  type GoogleSignInInput,
  type GoogleSignInResult,
  type GoogleSignInResponse,
  type GoogleSignInAuthApi,
} from './google-sign-in/index.js';

// google-sign-up
export {
  googleSignUp,
  googleSignUpSchema,
  type GoogleSignUpInput,
  type GoogleSignUpResult,
  type GoogleSignUpResponse,
  type GoogleSignUpAuthApi,
} from './google-sign-up/index.js';

// change-password
export {
  changePassword,
  changePasswordSchema,
  type ChangePasswordInput,
  type ChangePasswordResult,
  type ChangePasswordResponse,
  type ChangePasswordAuthApi,
} from './change-password/index.js';

// change-email
export {
  changeEmail,
  changeEmailSchema,
  type ChangeEmailInput,
  type ChangeEmailResult,
  type ChangeEmailResponse,
  type ChangeEmailAuthApi,
} from './change-email/index.js';

// check-email
export {
  checkEmail,
  checkEmailSchema,
  type CheckEmailInput,
  type CheckEmailResult,
  type CheckEmailResponse,
} from './check-email/index.js';

// apple-native-sign-in
export {
  appleNativeSignIn,
  appleNativeSignInSchema,
  type AppleNativeSignInInput,
  type AppleNativeSignInResult,
  type AppleNativeSignInResponse,
  type AppleNativeSignInAuthApi,
} from './apple-native-sign-in/index.js';

// invalidate-user-sessions
export {
  invalidateUserSessions,
  invalidateUserSessionsSchema,
  type InvalidateUserSessionsInput,
  type InvalidateUserSessionsResult,
  type InvalidateUserSessionsResponse,
  type RedisLike,
} from './invalidate-user-sessions/index.js';

// clear-active-org-sessions
export {
  clearActiveOrgSessions,
  clearActiveOrgSessionsSchema,
  type ClearActiveOrgSessionsInput,
  type ClearActiveOrgSessionsResult,
  type ClearActiveOrgSessionsResponse,
} from './clear-active-org-sessions/index.js';

// clear-session-secondary-storage-for-user
export {
  clearSessionSecondaryStorageForUser,
  clearSessionSecondaryStorageForUserSchema,
  type ClearSessionSecondaryStorageForUserInput,
  type ClearSessionSecondaryStorageForUserResult,
  type ClearSessionSecondaryStorageForUserResponse,
  type SessionSecondaryStorageRedis,
} from './clear-session-secondary-storage-for-user/index.js';

// forgot-password
export {
  forgotPassword,
  forgotPasswordSchema,
  type ForgotPasswordInput,
  type ForgotPasswordResult,
  type ForgotPasswordResponse,
  type ForgotPasswordAuthApi,
} from './forgot-password/index.js';

// reset-password
export {
  resetPassword,
  resetPasswordSchema,
  type ResetPasswordInput,
  type ResetPasswordResult,
  type ResetPasswordResponse,
  type ResetPasswordAuthApi,
} from './reset-password/index.js';

// enable-two-factor
export {
  enableTwoFactor,
  enableTwoFactorSchema,
  type EnableTwoFactorInput,
  type EnableTwoFactorResult,
  type EnableTwoFactorResponse,
  type EnableTwoFactorAuthApi,
} from './enable-two-factor/index.js';

// verify-totp
export {
  verifyTotp,
  verifyTotpSchema,
  type VerifyTotpInput,
  type VerifyTotpResult,
  type VerifyTotpResponse,
  type VerifyTotpAuthApi,
} from './verify-totp/index.js';

// verify-captcha
export { verifyCaptcha } from './verify-captcha/index.js';

// generate-intercom-jwt
export { generateIntercomJwt } from './generate-intercom-jwt/index.js';
