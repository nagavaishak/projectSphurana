import { conversation } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { importAdById } from '../../../meta-ads/services/import-ad-by-id/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { storePendingAdReferral } from './pending-ad-referral.js';
import { resolveAdReferral } from './resolve-ad-referral.js';
import {
  resolveInstagramContext,
  resolveMessengerContext,
} from './resolve-message-context.js';

const logger = createLogger('HandleStandaloneReferral');

export const handleStandaloneReferralSchema = z.object({
  pageId: z.string().min(1),
  senderId: z.string().min(1),
  platform: z.enum(['facebook_messenger', 'instagram_dm']),
  adReferral: z.object({
    metaAdId: z.string(),
    source: z.string().optional(),
    adTitle: z.string().optional(),
    adPhotoUrl: z.string().optional(),
    adVideoUrl: z.string().optional(),
  }),
});

export type HandleStandaloneReferralInput = z.infer<
  typeof handleStandaloneReferralSchema
>;

/**
 * Handle a standalone messaging_referral event (no message attached).
 * Meta sends these when a user enters a conversation thread via an ad click
 * before sending their first message. We store the ad context on the
 * conversation so it's available when the actual message arrives.
 */
const handleStandaloneReferralImpl = async (
  db: DbConnection,
  input: HandleStandaloneReferralInput
): Promise<Result<{ conversationId: string; adStored: boolean }>> => {
  const parsed = handleStandaloneReferralSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // 1. Resolve page context
  const resolved =
    parsed.data.platform === 'instagram_dm'
      ? await resolveInstagramContext(db, parsed.data.pageId)
      : await resolveMessengerContext(db, parsed.data.pageId);

  if (!resolved) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `No integration found for ${parsed.data.platform} page ${parsed.data.pageId}`
      )
    );
  }

  // 2. Resolve ad referral metadata (lazily importing unknown ads from Meta)
  const adReferral = await resolveAdReferral(db, parsed.data.adReferral, {
    onMissingAd: (metaAdId) =>
      importAdById(db, {
        organizationId: resolved.organizationId,
        metaAdId,
      }).then((r) => (r.success ? r.data.internalAdId : null)),
  });
  if (!adReferral) {
    return ok({ conversationId: '', adStored: false });
  }

  // 3. Find existing conversation
  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.organizationId, resolved.organizationId),
      eq(conversation.externalUserId, parsed.data.senderId),
      eq(conversation.platform, parsed.data.platform)
    ),
  });

  if (!conv) {
    // No conversation yet — store the referral in Redis so the
    // handleIncomingMessage service can pick it up when the actual
    // message arrives (Meta doesn't always include the referral on
    // the message event itself).
    await storePendingAdReferral(
      parsed.data.pageId,
      parsed.data.senderId,
      parsed.data.platform,
      parsed.data.adReferral
    );
    logger.info(
      'Standalone referral for unknown sender, stored pending referral',
      {
        pageId: parsed.data.pageId,
        senderId: parsed.data.senderId,
        adMetaId: adReferral.adMetaId,
      }
    );
    return ok({ conversationId: '', adStored: false });
  }

  // 4. Update conversation metadata with ad referral
  const existingMetadata = (conv.metadata as ConversationMetadata | null) ?? {};

  if (existingMetadata.adMetaId === adReferral.adMetaId) {
    // Same ad already stored
    return ok({ conversationId: conv.id, adStored: false });
  }

  const updatedMetadata = { ...existingMetadata, ...adReferral };
  await db
    .update(conversation)
    .set({ metadata: updatedMetadata })
    .where(eq(conversation.id, conv.id));

  logger.info('Stored ad referral from standalone referral event', {
    conversationId: conv.id,
    adMetaId: adReferral.adMetaId,
    adTitle: adReferral.adTitle,
  });

  return ok({ conversationId: conv.id, adStored: true });
};

export const handleStandaloneReferral = (
  db: DbConnection,
  input: HandleStandaloneReferralInput
) =>
  trackedResult(
    'conversations.handleStandaloneReferral',
    () => handleStandaloneReferralImpl(db, input),
    {
      properties: {
        pageId: input.pageId,
        platform: input.platform,
        adMetaId: input.adReferral.metaAdId,
      },
    }
  );

export type HandleStandaloneReferralResult = Awaited<
  ReturnType<typeof handleStandaloneReferral>
>;
