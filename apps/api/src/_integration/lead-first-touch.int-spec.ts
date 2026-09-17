/**
 * Claire's outbound-first sequence, asserted against a REAL database.
 *
 * The unit tests around `sendLeadFirstTouch` drive a mocked `db`, so they prove
 * the decisions but not the SQL. The three things that can only fail against
 * real Postgres are exactly the three this spec covers:
 *
 *   a. IDEMPOTENCY — the guard keys off the real unique constraint
 *      (organizationId, externalUserId, platform). A mock cannot tell you the
 *      second call collides.
 *   b. STAGE GUARD — `advanceLeadStage` narrows on the CURRENT status in the
 *      WHERE clause. Only real SQL proves a lead a human already moved is left
 *      alone.
 *   c. FOLLOW-UP STOP CONDITION — "has the lead replied" is a query over
 *      conversationMessage. Only a real row proves it.
 *
 * Twilio runs in dry-run (CAMPAIGNS_DRY_RUN), so sends short-circuit to
 * synthetic SIDs: no carrier, no spend, and no dependency on any of the
 * per-geography registration work in docs/plans/sms-three-geo-rollout.md.
 * WhatsApp is deliberately NOT exercised here — it needs a live WABA — so every
 * case below runs the SMS path.
 */
import { randomUUID } from 'node:crypto';
import {
  conversation,
  conversationMessage,
  db,
  lead,
  orgSmsNumber,
  orgSmsSender,
} from '@borradh-workspace/database';
import {
  sendLeadFirstTouch,
  sendLeadFollowUp,
} from '@borradh-workspace/features/conversations';
import { and, eq } from 'drizzle-orm';
import { seedOrgWithMember } from './harness.js';

/** A lead reachable by SMS, in the stage a fresh lead-form submission lands in. */
async function seedReachableLead(organizationId: string, phone: string) {
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

/** Give the org a two-way SMS identity — a number, never an alpha sender. */
async function seedSmsNumber(organizationId: string, phoneNumber: string) {
  await db.insert(orgSmsNumber).values({
    organizationId,
    phoneNumber,
    twilioSid: `PN${randomUUID().replace(/-/g, '')}`,
    country: 'IE',
    status: 'active',
  });
  await db
    .insert(orgSmsSender)
    .values({ organizationId, mode: 'number' })
    .onConflictDoNothing();
}

const uniquePhone = () =>
  `+3538${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Claire outbound-first (real DB, dry-run sends)', () => {
  it('opens a conversation, sends the opener, and moves the lead to contacted', async () => {
    const org = await seedOrgWithMember('owner');
    const phone = uniquePhone();
    await seedSmsNumber(org.organizationId, uniquePhone());
    const leadId = await seedReachableLead(org.organizationId, phone);

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.sent).toBe(true);

    const conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.organizationId, org.organizationId),
        eq(conversation.externalUserId, phone)
      ),
    });
    expect(conv).toBeTruthy();
    expect(conv?.platform).toBe('sms');
    // Claire opened it, so she owns it.
    expect(conv?.status).toBe('bot_handling');
    // The lead link lives in metadata, not a column.
    expect((conv?.metadata as { leadId?: string })?.leadId).toBe(leadId);

    // The opener was recorded as a bot message with the agreed copy.
    const messages = await db.query.conversationMessage.findMany({
      where: eq(conversationMessage.conversationId, conv?.id ?? ''),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('bot');
    expect(messages[0].content).toContain('Claire here from');
    expect(messages[0].content).toContain('the form you submitted');

    const after = await db.query.lead.findFirst({ where: eq(lead.id, leadId) });
    expect(after?.status).toBe('contacted');
  });

  // (a) Meta retries the webhook and the queue can redeliver.
  it('does not message the same lead twice', async () => {
    const org = await seedOrgWithMember('owner');
    const phone = uniquePhone();
    await seedSmsNumber(org.organizationId, uniquePhone());
    const leadId = await seedReachableLead(org.organizationId, phone);

    await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });
    const second = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(second.success && !second.data.sent && second.data.reason).toBe(
      'already_contacted'
    );

    const convs = await db.query.conversation.findMany({
      where: and(
        eq(conversation.organizationId, org.organizationId),
        eq(conversation.externalUserId, phone)
      ),
    });
    expect(convs).toHaveLength(1);

    const messages = await db.query.conversationMessage.findMany({
      where: eq(conversationMessage.conversationId, convs[0].id),
    });
    expect(messages).toHaveLength(1);
  });

  // Consent and suppression are the campaigns helpers — this proves they are
  // actually consulted against real rows, not just imported.
  it('does not message a lead without SMS consent', async () => {
    const org = await seedOrgWithMember('owner');
    const phone = uniquePhone();
    await seedSmsNumber(org.organizationId, uniquePhone());
    const leadId = await seedReachableLead(org.organizationId, phone);
    await db.update(lead).set({ consentSms: false }).where(eq(lead.id, leadId));

    const result = await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_eligible_channel'
    );
    const convs = await db.query.conversation.findMany({
      where: eq(conversation.organizationId, org.organizationId),
    });
    expect(convs).toHaveLength(0);
  });

  // (b) The guard is in the WHERE clause, so only real SQL proves it.
  it('never drags a lead a human already moved back to contacted', async () => {
    const org = await seedOrgWithMember('owner');
    const phone = uniquePhone();
    await seedSmsNumber(org.organizationId, uniquePhone());
    const leadId = await seedReachableLead(org.organizationId, phone);
    // Someone in the clinic marked this lead won before Claire's job ran.
    await db.update(lead).set({ status: 'won' }).where(eq(lead.id, leadId));

    await sendLeadFirstTouch(db, {
      organizationId: org.organizationId,
      leadId,
    });

    const after = await db.query.lead.findFirst({ where: eq(lead.id, leadId) });
    expect(after?.status).toBe('won');
  });

  describe('follow-ups', () => {
    // (c) The stop condition is a query over real message rows.
    it('does not nudge a lead who replied', async () => {
      const org = await seedOrgWithMember('owner');
      const phone = uniquePhone();
      await seedSmsNumber(org.organizationId, uniquePhone());
      const leadId = await seedReachableLead(org.organizationId, phone);
      await sendLeadFirstTouch(db, {
        organizationId: org.organizationId,
        leadId,
      });

      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.externalUserId, phone),
      });
      // The lead answers.
      await db.insert(conversationMessage).values({
        conversationId: conv?.id ?? '',
        role: 'user',
        content: 'I have acne scarring',
        messageType: 'text',
        sentAt: new Date(),
      });

      const result = await sendLeadFollowUp(db, {
        organizationId: org.organizationId,
        leadId,
        conversationId: conv?.id ?? '',
        step: 'followup_1',
      });

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'lead_replied'
      );
    });

    it('nudges a silent lead, and the second nudge marks them lost', async () => {
      const org = await seedOrgWithMember('owner');
      const phone = uniquePhone();
      await seedSmsNumber(org.organizationId, uniquePhone());
      const leadId = await seedReachableLead(org.organizationId, phone);
      await sendLeadFirstTouch(db, {
        organizationId: org.organizationId,
        leadId,
      });
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.externalUserId, phone),
      });
      const conversationId = conv?.id ?? '';

      const first = await sendLeadFollowUp(db, {
        organizationId: org.organizationId,
        leadId,
        conversationId,
        step: 'followup_1',
      });
      expect(first.success && first.data.sent).toBe(true);
      // Still contacted — the sequence is not over.
      expect(
        (await db.query.lead.findFirst({ where: eq(lead.id, leadId) }))?.status
      ).toBe('contacted');

      const second = await sendLeadFollowUp(db, {
        organizationId: org.organizationId,
        leadId,
        conversationId,
        step: 'followup_2',
      });
      expect(second.success && second.data.sent).toBe(true);

      // `lost` is the retired `cold`: the one stage that is WRITTEN, because
      // nothing in the data says we gave up on somebody.
      expect(
        (await db.query.lead.findFirst({ where: eq(lead.id, leadId) }))?.status
      ).toBe('lost');

      // Opener + two nudges, and nothing else.
      const messages = await db.query.conversationMessage.findMany({
        where: eq(conversationMessage.conversationId, conversationId),
      });
      expect(messages).toHaveLength(3);
      expect(messages.every((m) => m.role === 'bot')).toBe(true);
    });
  });
});
