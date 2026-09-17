// Client-safe auth schemas and types (no server-side dependencies)
// Use this entry point in frontend apps to avoid pulling in server-side code

// sign-up
export {
  signUpSchema,
  type SignUpInput,
} from './services/sign-up/sign-up.schema.js';

// sign-in
export {
  signInSchema,
  type SignInInput,
} from './services/sign-in/sign-in.schema.js';

// sign-out
export {
  signOutSchema,
  type SignOutInput,
} from './services/sign-out/sign-out.schema.js';

// get-session
export {
  getSessionSchema,
  type GetSessionInput,
} from './services/get-session/get-session.schema.js';

// change-password
export {
  changePasswordSchema,
  type ChangePasswordInput,
} from './services/change-password/change-password.schema.js';

// apple-native-sign-in
export {
  appleNativeSignInSchema,
  type AppleNativeSignInInput,
} from './services/apple-native-sign-in/apple-native-sign-in.schema.js';

// forgot-password
export {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from './services/forgot-password/forgot-password.schema.js';

// reset-password
export {
  resetPasswordSchema,
  type ResetPasswordInput,
} from './services/reset-password/reset-password.schema.js';

// Response types (from types files - NOT service files, to avoid pulling in server-side code)
export type { SignUpResponse } from './services/sign-up/sign-up.types.js';
export type { SignInResponse } from './services/sign-in/sign-in.types.js';
export type { SignOutResponse } from './services/sign-out/sign-out.types.js';
export type { SessionResponse } from './services/get-session/get-session.types.js';
export type { AppleNativeSignInResponse } from './services/apple-native-sign-in/apple-native-sign-in.types.js';
