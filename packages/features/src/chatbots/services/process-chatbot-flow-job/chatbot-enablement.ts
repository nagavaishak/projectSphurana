import {
  instagramIntegration,
  metaAdsPage,
  whatsappAccount,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Check if the chatbot is still enabled for the conversation's page/integration.
 * Returns false if the page was unassigned or Instagram chatbot was disabled.
 */
export async function isChatbotEnabledForConversation(
  db: DbConnection,
  conv: {
    metaAdsPageId: string | null;
    whatsappAccountId: string | null;
    platform: string;
    organizationId: string;
  }
): Promise<boolean> {
  // Meta Ads pages: check isChatbotActive flag directly
  if (conv.metaAdsPageId) {
    const page = await db.query.metaAdsPage.findFirst({
      where: eq(metaAdsPage.id, conv.metaAdsPageId),
      columns: { isChatbotActive: true },
    });
    return page?.isChatbotActive ?? false;
  }

  // Standalone Instagram: check chatbotEnabled flag for THIS org's integration
  if (conv.platform === 'instagram_dm') {
    const ig = await db.query.instagramIntegration.findFirst({
      where: and(
        eq(instagramIntegration.organizationId, conv.organizationId),
        eq(instagramIntegration.isActive, true)
      ),
      columns: { chatbotEnabled: true },
    });
    return ig?.chatbotEnabled ?? false;
  }

  // WhatsApp: check isChatbotActive flag directly
  if (conv.whatsappAccountId) {
    const wa = await db.query.whatsappAccount.findFirst({
      where: eq(whatsappAccount.id, conv.whatsappAccountId),
      columns: { isChatbotActive: true },
    });
    return wa?.isChatbotActive ?? false;
  }

  // Unknown platform — assume disabled
  return false;
}
