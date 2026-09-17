import {
  type MessagingPlatform,
  conversation,
  instagramIntegration,
  metaAdsIntegration,
  metaAdsPage,
  whatsappAccount,
} from '@borradh-workspace/database';
import { createLogger, trackEvent } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';

import { normalizeContact } from '../../../campaigns/index.js';
import type { DbConnection } from '../../../shared/index.js';

const logger = createLogger('HandleIncomingMessage');

/**
 * Shared return type for all context resolvers.
 */
export interface MessageContext {
  isChatbotActive: boolean;
  metaAdsPageId: string | null;
  whatsappAccountId: string | null;
  page:
    | typeof metaAdsPage.$inferSelect
    | {
        id: string;
        pageId: string;
        pageAccessToken: string | null;
        platform: 'instagram';
        pageName: string | null;
        pageUsername: string | null;
        pagePictureUrl: string | null;
        metaAdsIntegrationId: string;
        pixelId: string | null;
        pixelName: string | null;
        defaultLeadFormId: string | null;
        defaultLeadFormName: string | null;
        linkedInstagramAccountId: string | null;
        linkedInstagramUsername: string | null;
        linkedInstagramName: string | null;
        isActive: boolean;
        lastSyncAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }
    | null;
  organizationId: string;
}

/**
 * Resolve context for Instagram DMs via standalone Instagram integration.
 *
 * Routing: exact match on instagramIntegration.instagramUserId only.
 * No fallbacks, no global queries, no cross-org routing.
 *
 * The instagramUserId is set to profile.user_id (IGBA) during the Instagram
 * OAuth connect flow. This must match the webhook recipient.id exactly.
 */
export async function resolveInstagramContext(
  db: DbConnection,
  webhookPageId: string
): Promise<MessageContext | null> {
  const igIntegration = await db.query.instagramIntegration.findFirst({
    where: and(
      eq(instagramIntegration.instagramUserId, webhookPageId),
      eq(instagramIntegration.isActive, true)
    ),
  });

  if (!igIntegration) {
    logger.warn('No Instagram integration found for webhook recipient ID', {
      webhookPageId,
    });
    // Personless event keyed on the page so PostHog can trend unroutable
    // webhooks per Instagram account — a NEW page ID appearing here means a
    // real business's DMs are being dropped (ghost subscription or
    // instagramUserId mismatch), not just old-disconnect noise.
    trackEvent(
      'backend-system',
      'webhooks.unroutable_message',
      { platform: 'instagram_dm', pageId: webhookPageId },
      { personless: true }
    );
    return null;
  }

  return {
    isChatbotActive: igIntegration.chatbotEnabled ?? false,
    metaAdsPageId: null,
    whatsappAccountId: null,
    page: {
      id: igIntegration.id,
      pageId: webhookPageId,
      pageAccessToken: igIntegration.encryptedCredentials,
      platform: 'instagram' as const,
      pageName: igIntegration.name,
      pageUsername: igIntegration.username,
      pagePictureUrl: igIntegration.profilePictureUrl,
      metaAdsIntegrationId: '',
      pixelId: null,
      pixelName: null,
      defaultLeadFormId: null,
      defaultLeadFormName: null,
      linkedInstagramAccountId: null,
      linkedInstagramUsername: null,
      linkedInstagramName: null,
      isActive: true,
      lastSyncAt: null,
      createdAt: igIntegration.createdAt,
      updatedAt: igIntegration.updatedAt,
    },
    organizationId: igIntegration.organizationId,
  };
}

/**
 * Resolve context for Facebook Messenger via Meta Ads page.
 *
 * Routing: exact match on metaAdsPage.pageId only.
 * No fallbacks to Instagram integrations, no global queries.
 */
export async function resolveMessengerContext(
  db: DbConnection,
  pageId: string
): Promise<MessageContext | null> {
  const page = await db.query.metaAdsPage.findFirst({
    where: and(eq(metaAdsPage.pageId, pageId), eq(metaAdsPage.isActive, true)),
  });

  if (!page) {
    logger.warn('No metaAdsPage found for webhook page ID', { pageId });
    trackEvent(
      'backend-system',
      'webhooks.unroutable_message',
      { platform: 'facebook_messenger', pageId },
      { personless: true }
    );
    return null;
  }

  // Get organizationId via integration
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.id, page.metaAdsIntegrationId),
    columns: { organizationId: true },
  });
  if (!integration) return null;

  return {
    isChatbotActive: page.isChatbotActive ?? false,
    metaAdsPageId: page.id,
    whatsappAccountId: null,
    page,
    organizationId: integration.organizationId,
  };
}

/**
 * Resolve chatbot + context for WhatsApp.
 * Uses whatsappAccount → chatbotWhatsappAccount → chatbot lookup.
 */
export async function resolveWhatsAppChatbot(
  db: DbConnection,
  phoneNumberId: string
): Promise<MessageContext | null> {
  const waAccount = await db.query.whatsappAccount.findFirst({
    where: eq(whatsappAccount.phoneNumberId, phoneNumberId),
  });
  if (!waAccount) return null;

  return {
    isChatbotActive: waAccount.isChatbotActive ?? false,
    metaAdsPageId: null,
    whatsappAccountId: waAccount.id,
    page: null,
    organizationId: waAccount.organizationId,
  };
}

/**
 * Resolve the tenant context for an inbound SMS.
 *
 * SMS has no page or account id — the only routing signal is the number that
 * received the message. That is unambiguous when a number belongs to one org,
 * but the Irish launch plan puts several orgs behind a single shared number
 * (see docs/plans/sms-three-geo-rollout.md), and then `to` alone cannot say
 * which clinic the lead is talking to.
 *
 * Disambiguation, in order:
 *  1. Exactly one org owns the number — use it.
 *  2. Shared number — attribute to the org that most recently held an SMS
 *     conversation with this sender.
 *  3. Shared number with no prior conversation — give up and return null.
 *     Guessing would put a lead's message, and Claire's reply, in front of the
 *     wrong clinic. Dropping it is recoverable; mis-routing is not.
 */
export async function resolveSmsContext(
  db: DbConnection,
  to: string,
  from?: string
): Promise<MessageContext | null> {
  const toNorm = normalizeContact('sms', to);

  const numbers = await db.query.orgSmsNumber.findMany({
    columns: {
      organizationId: true,
      phoneNumber: true,
      isChatbotActive: true,
    },
  });
  const owners = numbers.filter(
    (n) => normalizeContact('sms', n.phoneNumber) === toNorm
  );

  if (owners.length === 0) {
    logger.warn('Inbound SMS to a number no org owns', {
      reason: 'sms_unknown_number',
    });
    return null;
  }

  let owner = owners[0];

  if (owners.length > 1) {
    if (!from) return null;
    const fromNorm = normalizeContact('sms', from);
    const existing = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.platform, 'sms'),
        eq(conversation.externalUserId, fromNorm)
      ),
      orderBy: [desc(conversation.lastMessageAt)],
    });
    const match = existing
      ? owners.find((o) => o.organizationId === existing.organizationId)
      : undefined;
    if (!match) {
      logger.warn('Inbound SMS on a shared number could not be attributed', {
        reason: 'sms_shared_number_ambiguous',
        candidateOrgs: owners.length,
      });
      return null;
    }
    owner = match;
  }

  return {
    isChatbotActive: owner.isChatbotActive,
    metaAdsPageId: null,
    whatsappAccountId: null,
    page: null,
    organizationId: owner.organizationId,
  };
}

/**
 * Resolve the tenant context for any messaging platform.
 *
 * Single dispatcher used by all inbound/echo/history handlers so every path
 * scopes DB lookups by the resolved `organizationId`. This is load-bearing
 * on WhatsApp, where `externalUserId` is a phone number shared across orgs —
 * looking up conversations without the org filter can cross-route events
 * between tenants.
 */
export async function resolveTenantContext(
  db: DbConnection,
  platform: MessagingPlatform,
  pageId: string,
  /**
   * The sender's address. Only consulted for SMS, where `pageId` is the
   * receiving number and may be shared by several orgs — see
   * {@link resolveSmsContext}.
   */
  senderId?: string
): Promise<MessageContext | null> {
  switch (platform) {
    case 'facebook_messenger':
      return resolveMessengerContext(db, pageId);
    case 'instagram_dm':
      return resolveInstagramContext(db, pageId);
    case 'whatsapp':
      return resolveWhatsAppChatbot(db, pageId);
    case 'sms':
      return resolveSmsContext(db, pageId, senderId);
  }
}
