import {
  type BookingAccount,
  bookingAccount,
  organization,
} from '@borradh-workspace/database';
import { CalendlyOAuthService } from '@borradh-workspace/integrations';
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
  type ConnectCalendlyInput,
  connectCalendlySchema,
} from './connect-calendly.schema.js';

/**
 * Internal implementation of connect Calendly
 */
const connectCalendlyImpl = async (
  db: DbConnection,
  input: ConnectCalendlyInput
): Promise<Result<BookingAccount>> => {
  const parsed = connectCalendlySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  try {
    const calendlyOAuth = new CalendlyOAuthService();
    const tokens = await calendlyOAuth.exchangeCodeForTokens(code);
    const userInfo = await calendlyOAuth.getCurrentUser(tokens.accessToken);

    // Check if already connected
    const existing = await db.query.bookingAccount.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.organizationId, organizationId),
          eq(t.provider, 'calendly'),
          eq(t.externalAccountId, userInfo.uri)
        ),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Calendly account ${userInfo.email} is already connected`
        )
      );
    }

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });

    // Calculate token expiry (Calendly tokens expire in 2 hours)
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Store in database
    const [result] = await db
      .insert(bookingAccount)
      .values({
        organizationId,
        userId,
        provider: 'calendly',
        externalAccountId: userInfo.uri,
        email: userInfo.email,
        displayName: userInfo.name,
        config: {
          calendly: {
            organizationUri: userInfo.currentOrganization,
            schedulingUrl: userInfo.schedulingUrl,
          },
        },
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    // Set org primaryCalendarType to calendly
    await db
      .update(organization)
      .set({
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: result.id,
      })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    return ok(result);
  } catch (error) {
    logError('integrations.connectCalendly', error, {
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
          'Failed to connect Calendly. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Calendly'
      )
    );
  }
};

/**
 * Connect a Calendly account to an organization
 */
export const connectCalendly = (
  db: DbConnection,
  input: ConnectCalendlyInput
) =>
  trackedResult(
    'integrations.connectCalendly',
    () => connectCalendlyImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ConnectCalendlyResult = Awaited<ReturnType<typeof connectCalendly>>;
