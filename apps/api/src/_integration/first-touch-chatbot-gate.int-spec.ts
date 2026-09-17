/**
 * Claire must be able to ANSWER before she is allowed to speak first.
 *
 * The opener introduces her, asks a qualifying question and says "just reply
 * here". If the chatbot is off on that channel, the lead's reply lands in an
 * `agent_handling` conversation and nothing responds — cold-messaging someone
 * and then ignoring their answer is worse than never messaging them.
 *
 * Asserted against a REAL database because the two halves live in different
 * services and only agree through rows: `sendLeadFirstTouch` reads
 * `isChatbotActive` off the sender to decide whether to open at all, and
 * `handleIncomingMessage` reads the SAME flag to decide whether to reply. A
 * mocked db proves neither half, and nothing proves they agree.
 *
 * Production shape this was written from (2026-08-20): of the seven clinics
 * with an approved opener template, THREE had `isChatbotActive = false` —
 * Zenelle, BeYOUtiful and Cougar. Deploying without this gate would have had
 * them cold-message leads and then go silent.
 *
 * WhatsApp is not exercised here — it needs a live WABA, the same reason
 * `lead-first-touch.int-spec.ts` runs every case on SMS. The gate itself is
 * channel-symmetric and its WhatsApp branch is unit-tested.
 */
import { randomUUID } from 'node:crypto';
import {
  auditLog,
  conversation,
  db,
  lead,
  orgSmsNumber,
  orgSmsSender,
} from '@borradh-workspace/database';
import { sendLeadFirstTouch } from '@borradh-workspace/features/conversations';
import { and, eq } from 'drizzle-orm';
import { seedOrgWithMember } from './harness.js';

const uniquePhone = () =>
  `+3538${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** A lead in the state a fresh lead-form submission lands in. */
async function seedLead(organizationId: string, phone: string) {
  const id = `lead_${randomUUID()}`;
  await db.insert(lead).values({
    id,
    organizationId,
    firstName: 'Sarah',
    lastName: 'Byrne',
    phone,
    source: 'meta_lead_form',
    status: 'new',
    consentSms: true,
  });
  return id;
}

/** Give the org a two-way SMS identity, with the chatbot on or off. */
async function seedSmsNumber(organizationId: string, chatbotOn: boolean) {
  await db.insert(orgSmsNumber).values({
    organizationId,
    phoneNumber: uniquePhone(),
    twilioSid: `PN${randomUUID().replace(/-/g, '')}`,
    country: 'IE',
    status: 'active',
    isChatbotActive: chatbotOn,
  });
  await db
    .insert(orgSmsSender)
    .values({ organizationId, mode: 'number' })
    .onConflictDoNothing();
}

describe('first touch is gated on Claire being able to reply (real DB)', () => {
  it('sends the opener when the chatbot is on', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, true);
    const leadId = await seedLead(org.organizationId, uniquePhone());

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(result.success && result.data.sent).toBe(true);
  });

  it('does not send the opener when the chatbot is off', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, false);
    const leadId = await seedLead(org.organizationId, uniquePhone());

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(result.success && result.data.sent).toBe(false);
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'chatbot_disabled'
    );
  });

  // The expensive half of the mistake. A skipped opener must leave NO trace:
  // no conversation row, and the lead untouched at `new`. If it advanced the
  // lead to `contacted`, the clinic's list would claim an outreach that never
  // happened — and nothing retries, since the queue is one-attempt.
  it('leaves no conversation and does not advance the lead when skipped', async () => {
    const org = await seedOrgWithMember('owner');
    const phone = uniquePhone();
    await seedSmsNumber(org.organizationId, false);
    const leadId = await seedLead(org.organizationId, phone);

    await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    const conversations = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.organizationId, org.organizationId),
          eq(conversation.externalUserId, phone)
        )
      );
    expect(conversations).toHaveLength(0);

    const after = await db.query.lead.findFirst({ where: eq(lead.id, leadId) });
    expect(after?.status).toBe('new');
  });

  // An org with no SMS number has no flag to read. That must resolve to "off",
  // not to an opener sent from a sender that does not exist.
  it('does not send when the org has no SMS number at all', async () => {
    const org = await seedOrgWithMember('owner');
    const leadId = await seedLead(org.organizationId, uniquePhone());

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(result.success && result.data.sent).toBe(false);
  });

  // Turning the chatbot on must make the SAME lead sendable — the gate is a
  // live read of clinic config, not a decision frozen at lead-creation time.
  it('sends once the clinic switches the chatbot on', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, false);
    const leadId = await seedLead(org.organizationId, uniquePhone());

    const blocked = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });
    expect(blocked.success && blocked.data.sent).toBe(false);

    await db
      .update(orgSmsNumber)
      .set({ isChatbotActive: true })
      .where(eq(orgSmsNumber.organizationId, org.organizationId));

    const allowed = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });
    expect(allowed.success && allowed.data.sent).toBe(true);
  });

  // A skip leaves no conversation, no message and an untouched lead — so
  // without this row it is invisible in SQL, and the PostHog event reads
  // `.success` either way. This is what makes "why has this clinic sent
  // nothing?" one query rather than log archaeology.
  it('writes an audit row explaining the skip', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, false);
    const leadId = await seedLead(org.organizationId, uniquePhone());

    await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    const rows = await db
      .select({ metadata: auditLog.metadata, entityType: auditLog.entityType })
      .from(auditLog)
      .where(eq(auditLog.entityId, leadId));

    expect(rows).toHaveLength(1);
    expect(rows[0].entityType).toBe('lead');
    expect(rows[0].metadata).toMatchObject({
      event: 'first_touch_skipped',
      reason: 'chatbot_disabled',
    });
  });

  // The sent case must be distinguishable from the skip in the SAME table, or
  // the trail cannot answer "did this lead get an opener?" on its own.
  it('writes an audit row naming the channel when it sends', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, true);
    const leadId = await seedLead(org.organizationId, uniquePhone());

    await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    const rows = await db
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.entityId, leadId));

    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      event: 'first_touch_sent',
      channel: 'sms',
      reason: null,
    });
  });

  // The gate is about whether Claire can REPLY, not whether the lead is
  // reachable — the two causes must stay distinguishable, or whoever debugs a
  // silent clinic is sent to the wrong place.
  it('still reports no_eligible_channel for an unreachable lead', async () => {
    const org = await seedOrgWithMember('owner');
    await seedSmsNumber(org.organizationId, true);
    const id = `lead_${randomUUID()}`;
    await db.insert(lead).values({
      id,
      organizationId: org.organizationId,
      firstName: 'Sarah',
      source: 'meta_lead_form',
      status: 'new',
      consentSms: true,
    });

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId: id,
    });

    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_eligible_channel'
    );
  });
});
