import { lead } from '@borradh-workspace/database';
import type { MessagingPlatform } from '@borradh-workspace/database';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { type DbConnection, notDeleted } from '../../../shared/index.js';

type LeadRow = typeof lead.$inferSelect;

export interface FindExistingLeadInput {
  organizationId: string;
  platform: MessagingPlatform;
  /** Sender id from the inbound message: phone (E.164) for WhatsApp, PSID/IGSID otherwise. */
  senderId: string;
  /** Contact details captured later in the conversation (used for Messenger/IG late-linking). */
  phone?: string | null;
  email?: string | null;
}

/**
 * Build phone match candidates that tolerate the `+` prefix difference between
 * WhatsApp inbound numbers (E.164 without `+`, e.g. `353871234567`) and stored
 * lead phones (often `+353871234567`).
 */
export function buildPhoneCandidates(
  values: (string | null | undefined)[]
): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const digits = trimmed.replace(/[^\d]/g, '');
    if (!digits) continue;
    out.add(trimmed);
    out.add(digits);
    out.add(`+${digits}`);
  }
  return [...out];
}

/**
 * Find the lead this conversation belongs to, by the strongest available
 * identifier. Prefers a Meta lead-form lead (so a follow-up message reuses the
 * original submission — carrying its form answers — instead of orphaning it),
 * then falls back to the most recent match.
 *
 * Identifiers available at message-arrival time:
 * - WhatsApp: the sender's phone (E.164) → match lead.phone / lead.whatsapp
 * - Messenger/Instagram: only the PSID/IGSID → match lead.psid. Lead-form leads
 *   carry no PSID, so they can only be linked once phone/email is captured and
 *   passed in via `phone`/`email`.
 */
export async function findExistingLead(
  db: DbConnection,
  input: FindExistingLeadInput
): Promise<LeadRow | null> {
  const { organizationId, platform, senderId, phone, email } = input;

  const conditions = [];

  const phoneCandidates = buildPhoneCandidates([
    platform === 'whatsapp' ? senderId : null,
    phone,
  ]);
  if (phoneCandidates.length > 0) {
    conditions.push(inArray(lead.whatsapp, phoneCandidates));
    conditions.push(inArray(lead.phone, phoneCandidates));
  }

  if (platform !== 'whatsapp' && senderId) {
    conditions.push(eq(lead.psid, senderId));
  }

  if (email?.trim()) {
    conditions.push(eq(sql`lower(${lead.email})`, email.trim().toLowerCase()));
  }

  if (conditions.length === 0) return null;

  return (
    (await db.query.lead.findFirst({
      where: and(
        eq(lead.organizationId, organizationId),
        notDeleted(lead),
        or(...conditions)
      ),
      // Prefer a lead-form lead (it carries the original enquiry), then most recent.
      orderBy: [
        sql`case when ${lead.source} = 'meta_lead_form' then 0 else 1 end`,
        desc(lead.createdAt),
      ],
    })) ?? null
  );
}
