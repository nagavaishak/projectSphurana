import type { SocialPost } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getSocialPost } from '../get-social-post/index.js';
import { publishSocialPost } from '../publish-social-post/index.js';
import {
  type StartSocialPostPublishInput,
  startSocialPostPublishSchema,
} from './start-social-post-publish.schema.js';

/**
 * BEGIN publishing a social post: validate that it is publishable, kick the
 * real publish off in the BACKGROUND, and return the post as the caller should
 * see it right now.
 *
 * This was the body of `POST /social-posts/:id/publish`. Three things about it
 * are contractual and must not drift (see
 * `apps/api/src/_integration/social-posts-controller.int-spec.ts`):
 *
 *  1. The two state guards are CONFLICTs with these exact messages — the UI
 *     shows them verbatim. `published` is "already done", `publishing` is the
 *     double-submit lock.
 *  2. The publish itself is deliberately NOT awaited. Video processing takes
 *     minutes; the HTTP request must not hold a connection open for it. Failures
 *     are logged, never surfaced to this caller.
 *  3. The returned post is SYNTHETIC: the pre-flight row with `status` overridden
 *     to `publishing`. Nothing has written that status to the database yet — the
 *     value tells the client what it just started, and the real status arrives on
 *     the next read.
 */
const startSocialPostPublishImpl = async (
  db: DbConnection,
  input: StartSocialPostPublishInput
): Promise<Result<SocialPost>> => {
  const parsed = startSocialPostPublishSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { id, organizationId } = parsed.data;

  // Org-scoped, so publish can never be aimed at another org's post.
  const postResult = await getSocialPost(db, { id, organizationId });
  if (!postResult.success) {
    return err(
      new FeatureError(
        postResult.error.code,
        postResult.error.message,
        postResult.error.details
      )
    );
  }

  const post = postResult.data;
  if (post.status === 'published') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Post has already been published',
        undefined
      )
    );
  }
  if (post.status === 'publishing') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Post is currently being published',
        undefined
      )
    );
  }

  void publishSocialPost(db, { id, organizationId })
    .then((result) => {
      if (!result.success) {
        logError(
          'socialPosts.backgroundPublish',
          new Error(`${result.error.code} - ${result.error.message}`),
          { feature: 'social-posts', extra: { postId: id, organizationId } }
        );
      }
    })
    .catch((error) => {
      logError('socialPosts.backgroundPublish', error, {
        feature: 'social-posts',
        extra: { postId: id, organizationId },
      });
    });

  return ok({ ...post, status: 'publishing' });
};

export const startSocialPostPublish = (
  db: DbConnection,
  input: StartSocialPostPublishInput
) =>
  trackedResult(
    'socialPosts.startPublish',
    () => startSocialPostPublishImpl(db, input),
    {
      properties: { postId: input.id, organizationId: input.organizationId },
    }
  );

export type StartSocialPostPublishResult = Awaited<
  ReturnType<typeof startSocialPostPublish>
>;
