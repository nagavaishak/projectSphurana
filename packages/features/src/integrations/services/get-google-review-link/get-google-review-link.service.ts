import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetGoogleReviewLinkInput,
  getGoogleReviewLinkSchema,
} from './get-google-review-link.schema.js';

export interface ReviewLinkData {
  reviewLink: string;
  locationName: string;
  placeId: string;
  averageRating: string | null;
  totalReviews: number | null;
}

const getGoogleReviewLinkImpl = async (
  db: DbConnection,
  input: GetGoogleReviewLinkInput
): Promise<Result<ReviewLinkData>> => {
  const parsed = getGoogleReviewLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  const account = await db.query.googleMyBusinessAccount.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.id, accountId), eq(t.organizationId, organizationId)),
    columns: {
      reviewLink: true,
      locationName: true,
      placeId: true,
      averageRating: true,
      totalReviews: true,
    },
  });

  if (!account) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Google My Business account not found'
      )
    );
  }

  return ok({
    reviewLink: account.reviewLink,
    locationName: account.locationName,
    placeId: account.placeId,
    averageRating: account.averageRating,
    totalReviews: account.totalReviews,
  });
};

export const getGoogleReviewLink = (
  db: DbConnection,
  input: GetGoogleReviewLinkInput
) =>
  trackedResult(
    'integrations.getGoogleReviewLink',
    () => getGoogleReviewLinkImpl(db, input),
    { properties: { accountId: input.accountId }, internalErrorsOnly: true }
  );

export type GetGoogleReviewLinkResult = Awaited<
  ReturnType<typeof getGoogleReviewLink>
>;
