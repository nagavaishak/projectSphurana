export {
  signUp,
  type SignUpResult,
  type SignUpResponse,
  type SignUpAuthApi,
} from './sign-up.service.js';
export { signUpSchema, type SignUpInput } from './sign-up.schema.js';
export {
  checkSignupEmail,
  isDeliverableEmailFormat,
  isDisposableEmail,
  getEmailDomain,
  DISPOSABLE_EMAIL_DOMAINS,
  type EmailRejectionReason,
} from './email-validation.js';
