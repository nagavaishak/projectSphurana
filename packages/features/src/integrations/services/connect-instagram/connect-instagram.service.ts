import {
  type InstagramIntegration,
  instagramIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  InstagramOAuthService,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectInstagramInput,
  connectInstagramSchema,
} from './connect-instagram.schema.js';

/** Default token lifetime: 60 days in milliseconds */
const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Internal implementation of connect Instagram
 */
const connectInstagramImpl = async (
  db: DbConnection,
  input: ConnectInstagramInput
): Promise<Result<InstagramIntegration>> => {
  const parsed = connectInstagramSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  // Track which flow step throws — the catch-all otherwise collapses every
  // provider failure into one indistinguishable INTERNAL_ERROR.
  let step = 'init';

  try {
    const igOAuth = new InstagramOAuthService();

    // 1. Exchange code for short-lived token
    step = 'exchange_code';
    const shortLived = await igOAuth.exchangeCodeForToken(code);

    // 2. Exchange for long-lived token
    step = 'exchange_long_lived_token';
    const longLived = await igOAuth.exchangeForLongLivedToken(
      shortLived.accessToken
    );

    // 3. Subscribe to webhooks so we receive DMs for this account
    step = 'subscribe_webhooks';
    try {
      await igOAuth.subscribeToWebhooks(longLived.accessToken);
    } catch (subscribeError) {
      // Log but don't fail — the integration is still usable without webhooks
      logError(
        'integrations.connectInstagram.subscribeWebhooks',
        subscribeError,
        {
          feature: 'integrations',
          extra: { organizationId },
        }
      );
    }

    // 4. Fetch user profile
    step = 'fetch_profile';
    const profile = await igOAuth.getUserProfile(longLived.accessToken);

    // 5. Encrypt credentials
    // profile.id = app-scoped ID, profile.user_id = Instagram-scoped ID (IGBA)
    // The IGBA is what Meta uses as recipient.id in webhooks, so we store it
    // as instagramUserId for direct webhook matching.
    const encryptedCreds = encryptCredentials({
      accessToken: longLived.accessToken,
      instagramUserId: profile.user_id,
    });

    // 6. Calculate token expiry
    const tokenExpiresAt = new Date(
      Date.now() +
        (longLived.expiresIn ? longLived.expiresIn * 1000 : TOKEN_LIFETIME_MS)
    );

    // 7. Upsert integration (insert or update if org already has one)
    step = 'upsert_integration';
    const existing = await db.query.instagramIntegration.findFirst({
      where: eq(instagramIntegration.organizationId, organizationId),
    });

    let result: InstagramIntegration;

    if (existing) {
      const [updated] = await db
        .update(instagramIntegration)
        .set({
          connectedById: userId,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          tokenStatus: 'valid',
          instagramUserId: profile.user_id,
          username: profile.username,
          name: profile.name,
          profilePictureUrl: profile.profile_picture_url ?? null,
          accountType: profile.account_type,
          isActive: true,
        })
        .where(eq(instagramIntegration.id, existing.id))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db
        .insert(instagramIntegration)
        .values({
          organizationId,
          connectedById: userId,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          instagramUserId: profile.user_id,
          username: profile.username,
          name: profile.name,
          profilePictureUrl: profile.profile_picture_url ?? null,
          accountType: profile.account_type,
        })
        .returning();
      result = inserted;
    }

    return ok(result);
  } catch (error) {
    logError('integrations.connectInstagram', error, {
      feature: 'integrations',
      extra: {
        organizationId,
        step,
        providerError: error instanceof Error ? error.message : String(error),
      },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to connect Instagram')
    );
  }
};

/**
 * Connect Instagram integration for an organization
 * Exchanges OAuth code for long-lived token and saves profile info
 */
export const connectInstagram = (
  db: DbConnection,
  input: ConnectInstagramInput
) =>
  trackedResult(
    'integrations.connectInstagram',
    () => withOrgScope((tx) => connectInstagramImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ConnectInstagramResult = Awaited<
  ReturnType<typeof connectInstagram>
>;
