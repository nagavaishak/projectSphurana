import {
  googleMyBusinessAccount,
  googleReview,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleMyBusinessOAuthService,
  decryptCredentials,
  starRatingToNumber,
} from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
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
  type SyncGoogleReviewsInput,
  syncGoogleReviewsSchema,
} from './sync-google-reviews.schema.js';

export interface SyncResult {
  synced: number;
  averageRating: number | null;
  totalReviews: number;
}

const syncGoogleReviewsImpl = async (
  db: DbConnection,
  input: SyncGoogleReviewsInput
): Promise<Result<SyncResult>> => {
  const parsed = syncGoogleReviewsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Get account with credentials
    const account = await db.query.googleMyBusinessAccount.findFirst({
      where: (t, { and, eq: eqFn }) =>
        and(eqFn(t.id, accountId), eqFn(t.organizationId, organizationId)),
    });

    if (!account) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Google My Business account not found'
        )
      );
    }

    // Decrypt credentials
    const credentials = decryptCredentials(account.encryptedCredentials) as {
      accessToken: string;
      refreshToken?: string;
    };

    const gmbOAuth = new GoogleMyBusinessOAuthService();

    // Try to refresh token if we have a refresh token
    let accessToken = credentials.accessToken;
    if (credentials.refreshToken) {
      try {
        const refreshed = await gmbOAuth.refreshAccessToken(
          credentials.refreshToken
        );
        accessToken = refreshed.accessToken;
      } catch {
        // Use existing token if refresh fails
      }
    }

    // Fetch reviews from Google
    const reviewsResponse = await gmbOAuth.getReviews(
      account.accountName,
      account.locationId,
      accessToken
    );

    // Upsert reviews
    let syncedCount = 0;
    for (const review of reviewsResponse.reviews) {
      await db
        .insert(googleReview)
        .values({
          googleMyBusinessAccountId: accountId,
          reviewId: review.reviewId,
          reviewerName: review.reviewer.displayName,
          reviewerPhotoUrl: review.reviewer.profilePhotoUrl ?? null,
          rating: starRatingToNumber(review.starRating),
          comment: review.comment ?? null,
          replyComment: review.reviewReply?.comment ?? null,
          repliedAt: review.reviewReply?.updateTime
            ? new Date(review.reviewReply.updateTime)
            : null,
          publishedAt: new Date(review.createTime),
        })
        .onConflictDoUpdate({
          target: [
            googleReview.googleMyBusinessAccountId,
            googleReview.reviewId,
          ],
          set: {
            reviewerName: review.reviewer.displayName,
            reviewerPhotoUrl: review.reviewer.profilePhotoUrl ?? null,
            rating: starRatingToNumber(review.starRating),
            comment: review.comment ?? null,
            replyComment: review.reviewReply?.comment ?? null,
            repliedAt: review.reviewReply?.updateTime
              ? new Date(review.reviewReply.updateTime)
              : null,
          },
        });
      syncedCount++;
    }

    // Update account stats
    const avgRating = reviewsResponse.averageRating ?? null;
    const totalReviews = reviewsResponse.totalReviewCount ?? syncedCount;

    await db
      .update(googleMyBusinessAccount)
      .set({
        averageRating: avgRating ? String(avgRating) : null,
        totalReviews,
        lastSyncAt: new Date(),
      })
      .where(eq(googleMyBusinessAccount.id, accountId));

    return ok({
      synced: syncedCount,
      averageRating: avgRating,
      totalReviews,
    });
  } catch (error) {
    logError('integrations.syncGoogleReviews', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    if (
      error instanceof Error &&
      (error.message.includes('Failed to get reviews') ||
        error.message.includes('Failed to refresh'))
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to sync reviews from Google. Your connection may need to be refreshed.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while syncing reviews'
      )
    );
  }
};

export const syncGoogleReviews = (
  db: DbConnection,
  input: SyncGoogleReviewsInput
) =>
  trackedResult(
    'integrations.syncGoogleReviews',
    () => withOrgScope((tx) => syncGoogleReviewsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type SyncGoogleReviewsResult = Awaited<
  ReturnType<typeof syncGoogleReviews>
>;
