import { metaAdsPage } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';

/**
 * Enable the chatbot for a Meta Ads page.
 *
 * Sets isChatbotActive = true on the page directly.
 * The chatbot configuration lives on the organization — no separate chatbot entity needed.
 */
export const enableChatbotForPage = async (
  db: DbConnection,
  input: {
    metaAdsPageId: string;
  }
): Promise<Result<void>> => {
  const { metaAdsPageId } = input;

  await db
    .update(metaAdsPage)
    .set({ isChatbotActive: true })
    .where(eq(metaAdsPage.id, metaAdsPageId));

  return ok(undefined);
};
