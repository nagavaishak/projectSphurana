/**
 * `listConversations` hides message-less conversations — asserted against a
 * REAL database, because the whole behaviour is one SQL `EXISTS` and a mocked
 * `db` would only prove the mock returns what it was told to.
 *
 * A conversation row is created BEFORE its first message is delivered, on
 * purpose: it is the idempotency record that stops a retried Meta webhook
 * double-messaging a lead. So when delivery fails the row survives with an
 * empty thread, and an org with no SMS sender provisioned grows one per
 * lead-form lead. The inbox would show each as a contact with a blank preview.
 */
import { randomUUID } from 'node:crypto';
import {
  conversation,
  conversationMessage,
  db,
} from '@borradh-workspace/database';
import { listConversations } from '@borradh-workspace/features/conversations';
import { eq } from 'drizzle-orm';
import { seedOrgWithMember } from './harness.js';

async function seedConversation(
  organizationId: string,
  opts: { withMessage: boolean; status?: 'bot_handling' | 'agent_handling' }
) {
  const [row] = await db
    .insert(conversation)
    .values({
      organizationId,
      platform: 'sms',
      externalUserId: `+3538${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      status: opts.status ?? 'bot_handling',
      lastMessageAt: new Date(),
    })
    .returning();

  if (opts.withMessage) {
    await db.insert(conversationMessage).values({
      conversationId: row.id,
      role: 'bot',
      content: `hello ${randomUUID()}`,
      messageType: 'text',
      sentAt: new Date(),
    });
  }
  return row.id;
}

describe('listConversations (real DB)', () => {
  it('lists a conversation that has messages and hides one that does not', async () => {
    const org = await seedOrgWithMember('owner');
    const withMessage = await seedConversation(org.organizationId, {
      withMessage: true,
    });
    const empty = await seedConversation(org.organizationId, {
      withMessage: false,
    });

    const result = await listConversations(db, {
      organizationId: org.organizationId,
      limit: 50,
      offset: 0,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const ids = result.data.conversations.map((c) => c.id);
    expect(ids).toContain(withMessage);
    expect(ids).not.toContain(empty);
  });

  // The count is a separate query. If it did not share the same WHERE, the
  // inbox would claim more conversations than it can show — the kind of
  // mismatch that reads as a pagination bug and gets chased for hours.
  it('counts what it lists, not what it hides', async () => {
    const org = await seedOrgWithMember('owner');
    await seedConversation(org.organizationId, { withMessage: true });
    await seedConversation(org.organizationId, { withMessage: false });
    await seedConversation(org.organizationId, { withMessage: false });

    const result = await listConversations(db, {
      organizationId: org.organizationId,
      limit: 50,
      offset: 0,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.total).toBe(1);
    expect(result.data.conversations).toHaveLength(1);
  });

  // The empty row must still EXIST — hiding it is a read-time concern, and
  // deleting it would forfeit the idempotency guarantee that a retried webhook
  // cannot open a second conversation and send a second opener.
  it('hides the empty conversation without deleting it', async () => {
    const org = await seedOrgWithMember('owner');
    const empty = await seedConversation(org.organizationId, {
      withMessage: false,
    });

    const result = await listConversations(db, {
      organizationId: org.organizationId,
      limit: 50,
      offset: 0,
    });
    expect(result.success && result.data.conversations).toHaveLength(0);

    const stillThere = await db.query.conversation.findFirst({
      where: eq(conversation.id, empty),
    });
    expect(stillThere).toBeTruthy();
  });

  // A message arriving is what makes a conversation real, so the same row must
  // appear once one lands — this is the path a lead's reply takes.
  it('reveals the conversation as soon as a message lands', async () => {
    const org = await seedOrgWithMember('owner');
    const id = await seedConversation(org.organizationId, {
      withMessage: false,
    });

    const before = await listConversations(db, {
      organizationId: org.organizationId,
      limit: 50,
      offset: 0,
    });
    expect(before.success && before.data.conversations).toHaveLength(0);

    await db.insert(conversationMessage).values({
      conversationId: id,
      role: 'user',
      content: 'yes please',
      messageType: 'text',
      sentAt: new Date(),
    });

    const after = await listConversations(db, {
      organizationId: org.organizationId,
      limit: 50,
      offset: 0,
    });
    expect(after.success && after.data.conversations.map((c) => c.id)).toEqual([
      id,
    ]);
  });
});
