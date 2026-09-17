import {
  instagramIntegration,
  socialPost,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

const disconnectInstagramSchema = z.object({
  organizationId: z.string().min(1),
});

type DisconnectInstagramInput = z.infer<typeof disconnectInstagramSchema>;

/**
 * Internal implementation of disconnect Instagram
 */
const disconnectInstagramImpl = async (
  db: DbConnection,
  input: DisconnectInstagramInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectInstagramSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const existing = await db.query.instagramIntegration.findFirst({
      where: eq(instagramIntegration.organizationId, organizationId),
    });

    if (!existing) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Instagram integration not found'
        )
      );
    }

    await db.transaction(async (tx) => {
      // Delete draft/scheduled social posts targeting only Instagram
      await tx
        .delete(socialPost)
        .where(
          and(
            eq(socialPost.organizationId, organizationId),
            sql`${socialPost.platforms} = '["instagram"]'::jsonb`,
            sql`${socialPost.status} IN ('draft', 'scheduled')`
          )
        );

      // Delete the Instagram integration
      await tx
        .delete(instagramIntegration)
        .where(eq(instagramIntegration.organizationId, organizationId));
    });

    return ok({ success: true as const });
  } catch (error) {
    logError('integrations.disconnectInstagram', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect Instagram'
      )
    );
  }
};

/**
 * Disconnect Instagram integration from an organization
 */
export const disconnectInstagram = (
  db: DbConnection,
  input: DisconnectInstagramInput
) =>
  trackedResult(
    'integrations.disconnectInstagram',
    () => withOrgScope((tx) => disconnectInstagramImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectInstagramResult = Awaited<
  ReturnType<typeof disconnectInstagram>
>;
