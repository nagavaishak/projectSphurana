import { account, user } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CheckEmailInput,
  checkEmailSchema,
} from './check-email.schema.js';
import type { CheckEmailResponse } from './check-email.types.js';

/**
 * Internal implementation of check email
 */
const checkEmailImpl = async (
  db: DbConnection,
  input: CheckEmailInput
): Promise<
  | { success: true; data: CheckEmailResponse }
  | { success: false; error: FeatureError }
> => {
  // Validate input
  const parsed = checkEmailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Find user by email
  const foundUser = await db.query.user.findFirst({
    where: eq(user.email, parsed.data.email.toLowerCase()),
  });

  if (!foundUser) {
    // Return that user doesn't exist - they need to sign up
    return ok({
      exists: false,
      hasPassword: false,
      providers: [],
    });
  }

  // Get all accounts for this user
  const accounts = await db
    .select({
      providerId: account.providerId,
      password: account.password,
    })
    .from(account)
    .where(eq(account.userId, foundUser.id));

  // Check if user has a credential account with password
  const credentialAccount = accounts.find(
    (acc) => acc.providerId === 'credential'
  );
  const hasPassword = !!credentialAccount?.password;

  // Get unique providers (exclude credential, show oauth providers)
  const oauthProviders = accounts
    .filter((acc) => acc.providerId !== 'credential')
    .map((acc) => acc.providerId);

  return ok({
    exists: true,
    hasPassword,
    providers: oauthProviders,
  });
};

/**
 * Check if an email exists and what sign-in methods are available
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Check email input
 * @returns Result with email status or error
 *
 * @example
 * ```ts
 * const result = await checkEmail(db, { email: 'user@example.com' });
 *
 * if (result.success) {
 *   if (!result.data.exists) {
 *     // User needs to sign up
 *   } else if (result.data.hasPassword) {
 *     // Show password field
 *   } else {
 *     // Redirect to OAuth provider
 *   }
 * }
 * ```
 */
export const checkEmail = (db: DbConnection, input: CheckEmailInput) =>
  trackedResult('auth.checkEmail', () => checkEmailImpl(db, input), {
    properties: { email: input.email },
  });

/**
 * Result type for checkEmail
 */
export type CheckEmailResult = Awaited<ReturnType<typeof checkEmail>>;
