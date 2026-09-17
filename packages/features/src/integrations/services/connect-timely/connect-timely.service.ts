import {
  type BookingAccount,
  bookingAccount,
  organization,
} from '@borradh-workspace/database';
import { TimelyOAuthService } from '@borradh-workspace/integrations';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectTimelyInput,
  connectTimelySchema,
} from './connect-timely.schema.js';

/**
 * Internal implementation of connect Timely
 */
const connectTimelyImpl = async (
  db: DbConnection,
  input: ConnectTimelyInput
): Promise<Result<BookingAccount>> => {
  const parsed = connectTimelySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  try {
    const timelyOAuth = new TimelyOAuthService();
    const tokens = await timelyOAuth.exchangeCodeForTokens(code);

    // Get user's accounts
    const accounts = await timelyOAuth.getAccounts(tokens.accessToken);
    if (accounts.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'No Timely accounts found. Please ensure you have access to at least one account.'
        )
      );
    }

    // Use the first account (primary)
    const primaryAccount = accounts[0];
    const externalAccountId = primaryAccount.id.toString();

    // Check if already connected
    const existing = await db.query.bookingAccount.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.organizationId, organizationId),
          eq(t.provider, 'timely'),
          eq(t.externalAccountId, externalAccountId)
        ),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Timely account ${primaryAccount.name} is already connected`
        )
      );
    }

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
    });

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Store in database
    const [result] = await db
      .insert(bookingAccount)
      .values({
        organizationId,
        userId,
        provider: 'timely',
        externalAccountId,
        email: primaryAccount.email,
        displayName: primaryAccount.name,
        config: {
          timely: {
            accountId: externalAccountId,
          },
        },
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    // Set org primaryCalendarType to timely
    await db
      .update(organization)
      .set({
        primaryCalendarType: 'timely',
        primaryCalendarAccountId: result.id,
      })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    return ok(result);
  } catch (error) {
    logError('integrations.connectTimely', error, {
      feature: 'integrations',
      extra: { organizationId, userId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Timely. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Timely'
      )
    );
  }
};

/**
 * Connect a Timely account to an organization
 */
export const connectTimely = (db: DbConnection, input: ConnectTimelyInput) =>
  trackedResult(
    'integrations.connectTimely',
    () => connectTimelyImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ConnectTimelyResult = Awaited<ReturnType<typeof connectTimely>>;
