import {
  type TokenStatus,
  instagramIntegration,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

const getInstagramIntegrationSchema = z.object({
  organizationId: z.string().min(1),
});

type GetInstagramIntegrationInput = z.infer<
  typeof getInstagramIntegrationSchema
>;

export interface InstagramIntegrationInfo {
  id: string;
  instagramUserId: string | null;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
  isActive: boolean;
  chatbotEnabled: boolean;
  tokenStatus: TokenStatus;
  connectedByName: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
}

/**
 * Internal implementation of get Instagram integration
 */
const getInstagramIntegrationImpl = async (
  db: DbConnection,
  input: GetInstagramIntegrationInput
): Promise<Result<{ integration: InstagramIntegrationInfo | null }>> => {
  const parsed = getInstagramIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const [result] = await db
      .select({
        id: instagramIntegration.id,
        instagramUserId: instagramIntegration.instagramUserId,
        username: instagramIntegration.username,
        name: instagramIntegration.name,
        profilePictureUrl: instagramIntegration.profilePictureUrl,
        accountType: instagramIntegration.accountType,
        isActive: instagramIntegration.isActive,
        chatbotEnabled: instagramIntegration.chatbotEnabled,
        tokenStatus: instagramIntegration.tokenStatus,
        connectedByName: user.name,
        tokenExpiresAt: instagramIntegration.tokenExpiresAt,
        createdAt: instagramIntegration.createdAt,
      })
      .from(instagramIntegration)
      .leftJoin(user, eq(instagramIntegration.connectedById, user.id))
      .where(eq(instagramIntegration.organizationId, organizationId))
      .limit(1);

    if (!result) {
      return ok({ integration: null });
    }

    return ok({ integration: result });
  } catch (error) {
    logError('integrations.getInstagramIntegration', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to get Instagram integration'
      )
    );
  }
};

/**
 * Get Instagram integration for an organization
 */
export const getInstagramIntegration = (
  db: DbConnection,
  input: GetInstagramIntegrationInput
) =>
  trackedResult(
    'integrations.getInstagramIntegration',
    () => withOrgScope((tx) => getInstagramIntegrationImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetInstagramIntegrationResult = Awaited<
  ReturnType<typeof getInstagramIntegration>
>;
