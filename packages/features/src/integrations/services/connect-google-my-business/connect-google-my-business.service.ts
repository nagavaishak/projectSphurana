import {
  type GoogleMyBusinessAccount,
  googleMyBusinessAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleMyBusinessOAuthService,
  buildReviewLink,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectGoogleMyBusinessInput,
  connectGoogleMyBusinessSchema,
} from './connect-google-my-business.schema.js';

const connectGoogleMyBusinessImpl = async (
  db: DbConnection,
  input: ConnectGoogleMyBusinessInput
): Promise<Result<GoogleMyBusinessAccount>> => {
  const parsed = connectGoogleMyBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code, locationId, accountName } = parsed.data;

  try {
    const gmbOAuth = new GoogleMyBusinessOAuthService();
    const tokens = await gmbOAuth.exchangeCodeForTokens(code);
    const userInfo = await gmbOAuth.getUserInfo(tokens.accessToken);

    // Get locations for the selected account to find placeId
    const locations = await gmbOAuth.getLocations(
      accountName,
      tokens.accessToken
    );
    const selectedLocation = locations.find((loc) => loc.name === locationId);

    if (!selectedLocation) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Selected location not found')
      );
    }

    if (!selectedLocation.placeId) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Location does not have a Place ID. It may not be verified on Google.'
        )
      );
    }

    // Check if already connected
    const existing = await db.query.googleMyBusinessAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.locationId, locationId)),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Location "${selectedLocation.title}" is already connected`
        )
      );
    }

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });

    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    const reviewLink = buildReviewLink(selectedLocation.placeId);

    // Store in database
    const [result] = await db
      .insert(googleMyBusinessAccount)
      .values({
        organizationId,
        connectedById: userId,
        googleAccountEmail: userInfo.email,
        accountName,
        locationId,
        locationName: selectedLocation.title,
        placeId: selectedLocation.placeId,
        reviewLink,
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('integrations.connectGoogleMyBusiness', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Google My Business. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Google My Business'
      )
    );
  }
};

export const connectGoogleMyBusiness = (
  db: DbConnection,
  input: ConnectGoogleMyBusinessInput
) =>
  trackedResult(
    'integrations.connectGoogleMyBusiness',
    () => withOrgScope((tx) => connectGoogleMyBusinessImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ConnectGoogleMyBusinessResult = Awaited<
  ReturnType<typeof connectGoogleMyBusiness>
>;
