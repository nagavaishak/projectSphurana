import { lead } from '@borradh-workspace/database';
import type { MessagingPlatform } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';

import { notifyLeadCreatedSafe } from '../../../leads/index.js';
import type { DbConnection } from '../../../shared/index.js';
import { findExistingLead } from './find-existing-lead.js';

/**
 * Map messaging platform to lead source
 */
export const platformToLeadSource = (platform: MessagingPlatform) => {
  switch (platform) {
    case 'facebook_messenger':
      return 'facebook' as const;
    case 'instagram_dm':
      return 'instagram' as const;
    case 'whatsapp':
      return 'whatsapp' as const;
    case 'sms':
      return 'sms' as const;
  }
};

/**
 * Link a new conversation to its originating lead, or create one if none exists.
 * Returns the lead id so the caller can store it on the conversation.
 *
 * Reuses an existing lead-form lead when the sender matches (so a Messenger/
 * WhatsApp follow-up to a Meta lead form keeps the original submission and its
 * form answers) instead of silently creating a duplicate. WhatsApp matches by
 * phone; Messenger/Instagram store the PSID/IGSID in `lead.psid`.
 */
export async function linkOrCreateConversationLead(
  db: DbConnection,
  organizationId: string,
  senderId: string,
  senderName: string | undefined,
  platform: MessagingPlatform,
  conversationId?: string
): Promise<string | null> {
  try {
    const existing = await findExistingLead(db, {
      organizationId,
      platform,
      senderId,
    });
    if (existing) return existing.id;

    // Parse sender name into firstName / lastName
    const nameParts = senderName?.trim().split(/\s+/);
    const firstName = nameParts?.[0] || senderId;
    const lastName =
      nameParts && nameParts.length > 1
        ? nameParts.slice(1).join(' ')
        : undefined;

    const [created] = await db
      .insert(lead)
      .values({
        organizationId,
        firstName,
        lastName,
        source: platformToLeadSource(platform),
        status: 'new',
        // They messaged the business first — contactable by default.
        consentEmail: true,
        consentSms: true,
        consentVoice: true,
        consentSource: 'incoming_message',
        consentedAt: new Date(),
        ...(platform === 'whatsapp'
          ? { whatsapp: senderId }
          : { psid: senderId }),
      })
      .returning({ id: lead.id });

    // Only the created path notifies — reusing an existing lead above returns
    // early, so a follow-up message never re-pings the team.
    if (created) {
      notifyLeadCreatedSafe(db, {
        organizationId,
        leadId: created.id,
        firstName,
        lastName,
        source: platformToLeadSource(platform),
        conversationId,
      });
    }

    return created?.id ?? null;
  } catch (error) {
    // Non-critical — don't fail the message handling
    logError('conversations.linkOrCreateConversationLead', error, {
      feature: 'conversations',
      extra: { organizationId, senderId, platform },
    });
    return null;
  }
}
