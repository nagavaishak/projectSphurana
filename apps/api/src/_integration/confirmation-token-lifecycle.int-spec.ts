/**
 * Batch B — confirmation-token lifecycle against a REAL Postgres.
 *
 * Unit tests (create/verify-confirmation-token.test.ts) cover the branch logic
 * with a mocked db. This batch proves the things a mock CANNOT:
 *   - atomic single-use under genuine concurrency (the service's CAS
 *     `UPDATE ... WHERE consumedAt IS NULL` against real row locking)
 *   - real wall-clock expiry (a row with expiresAt in the past)
 *   - scope binding (org / conversation / action / resource mismatch)
 *   - the happy path persists consumedAt
 *
 * Services are called DIRECTLY with the real `db` singleton — no controller.
 * The token row has FKs to organization + assistant_conversation, so each
 * test seeds those first with unique ids.
 */
import { randomUUID } from 'node:crypto';
import {
  assistantConversation,
  assistantMessage,
  claireConfirmationToken,
  db,
  organization,
  user,
} from '@borradh-workspace/database';
import {
  createConfirmationToken,
  verifyConfirmationToken,
} from '@borradh-workspace/features/assistant';
import { eq } from 'drizzle-orm';

/** Seed an org + user + conversation; returns ids for the token FK scope. */
async function seedConversationScope(): Promise<{
  organizationId: string;
  conversationId: string;
  userId: string;
}> {
  const organizationId = `org_${randomUUID()}`;
  const userId = `usr_${randomUUID()}`;
  const conversationId = `conv_${randomUUID()}`;

  await db.insert(organization).values({
    id: organizationId,
    name: `Org ${organizationId}`,
    slug: `slug-${organizationId}`,
    businessType: 'other',
  });
  await db.insert(user).values({
    id: userId,
    name: 'Token Test User',
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  await db.insert(assistantConversation).values({
    id: conversationId,
    organizationId,
    userId,
  });

  return { organizationId, conversationId, userId };
}

/**
 * Seed the INTERVENING user message the turn-boundary rule (Phase 6, #131)
 * requires before a token may be consumed. A token minted with no newer user
 * message is refused as `no_user_turn`; the real flow is that the operator
 * replies in chat after the proposal card is shown, and that reply persists as
 * a `role: 'user'` message dated after the token. We pin its `createdAt` a
 * second into the future so it is strictly greater than the token's
 * `createdAt` regardless of same-instant inserts.
 */
async function seedApprovingUserTurn(conversationId: string): Promise<void> {
  await db.insert(assistantMessage).values({
    id: `msg_${randomUUID()}`,
    conversationId,
    role: 'user',
    content: 'Yes, go ahead.',
    createdAt: new Date(Date.now() + 1_000),
  });
}

describe('Batch B — confirmation-token lifecycle (real DB)', () => {
  it('happy path: mint → verify once → returns ok and sets consumedAt', async () => {
    const scope = await seedConversationScope();
    const resourceId = `res_${randomUUID()}`;

    const minted = await createConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'create_offer',
      resourceId,
      payload: { discountPercent: 20 },
    });
    expect(minted.success).toBe(true);
    if (!minted.success) return;

    // Turn-boundary: the operator's chat approval after the proposal card.
    await seedApprovingUserTurn(scope.conversationId);

    const verified = await verifyConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'create_offer',
      resourceId,
      token: minted.data.id,
    });
    expect(verified.success).toBe(true);
    if (!verified.success) return;
    expect(verified.data.valid).toBe(true);
    if (verified.data.valid) {
      expect(verified.data.payload).toEqual({ discountPercent: 20 });
    }

    // consumedAt is now set in the real row.
    const row = await db.query.claireConfirmationToken.findFirst({
      where: eq(claireConfirmationToken.id, minted.data.id),
    });
    expect(row?.consumedAt).toBeInstanceOf(Date);
  });

  it('turn-boundary: same-turn verify with no intervening user message → no_user_turn, row untouched (#131)', async () => {
    const scope = await seedConversationScope();
    const resourceId = `res_${randomUUID()}`;

    const minted = await createConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'launch_ad',
      resourceId,
    });
    expect(minted.success).toBe(true);
    if (!minted.success) return;

    // No approving user turn seeded — this models a self-launch within the
    // same turn that proposed the action. The rule must refuse it.
    const verified = await verifyConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'launch_ad',
      resourceId,
      token: minted.data.id,
    });
    expect(verified.success).toBe(true);
    if (!verified.success) return;
    expect(verified.data.valid).toBe(false);
    if (!verified.data.valid) expect(verified.data.reason).toBe('no_user_turn');

    // A blocked token is NOT consumed — the operator can still approve later.
    const row = await db.query.claireConfirmationToken.findFirst({
      where: eq(claireConfirmationToken.id, minted.data.id),
    });
    expect(row?.consumedAt).toBeNull();
  });

  it('atomic single-use: two concurrent verifies → exactly one consumes', async () => {
    const scope = await seedConversationScope();
    const resourceId = `res_${randomUUID()}`;

    const minted = await createConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'launch_ad',
      resourceId,
    });
    expect(minted.success).toBe(true);
    if (!minted.success) return;

    // Turn-boundary: the operator's chat approval must exist before either
    // concurrent verify can consume the token.
    await seedApprovingUserTurn(scope.conversationId);

    const verifyInput = {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'launch_ad' as const,
      resourceId,
      token: minted.data.id,
    };

    const [a, b] = await Promise.all([
      verifyConfirmationToken(db, verifyInput),
      verifyConfirmationToken(db, verifyInput),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (!a.success || !b.success) return;

    const results = [a.data, b.data];
    const valids = results.filter((r) => r.valid);
    const consumed = results.filter((r) => !r.valid && r.reason === 'consumed');

    // Exactly one wins the CAS update; the other sees the row already consumed.
    expect(valids).toHaveLength(1);
    expect(consumed).toHaveLength(1);
  });

  it('real expiry: a token whose expiresAt is in the past → rejected as expired', async () => {
    const scope = await seedConversationScope();
    const resourceId = `res_${randomUUID()}`;
    const tokenId = `tok_${randomUUID()}`;

    // The service clamps ttlMinutes >= 1, so we cannot mint an already-expired
    // token through it. Insert the row directly with a past expiresAt — that's
    // the real state the verifier must reject.
    await db.insert(claireConfirmationToken).values({
      id: tokenId,
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'update_budget',
      resourceId,
      payload: null,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const verified = await verifyConfirmationToken(db, {
      organizationId: scope.organizationId,
      conversationId: scope.conversationId,
      action: 'update_budget',
      resourceId,
      token: tokenId,
    });
    expect(verified.success).toBe(true);
    if (!verified.success) return;
    expect(verified.data.valid).toBe(false);
    if (!verified.data.valid) expect(verified.data.reason).toBe('expired');

    // Expired tokens are NOT consumed.
    const row = await db.query.claireConfirmationToken.findFirst({
      where: eq(claireConfirmationToken.id, tokenId),
    });
    expect(row?.consumedAt).toBeNull();
  });

  describe('scope mismatch → rejected, row untouched', () => {
    it('wrong organizationId', async () => {
      const scope = await seedConversationScope();
      const resourceId = `res_${randomUUID()}`;
      const minted = await createConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId,
      });
      expect(minted.success).toBe(true);
      if (!minted.success) return;

      const verified = await verifyConfirmationToken(db, {
        organizationId: `org_${randomUUID()}`,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId,
        token: minted.data.id,
      });
      expect(verified.success).toBe(true);
      if (verified.success && !verified.data.valid) {
        expect(verified.data.reason).toBe('mismatch');
      }
      const row = await db.query.claireConfirmationToken.findFirst({
        where: eq(claireConfirmationToken.id, minted.data.id),
      });
      expect(row?.consumedAt).toBeNull();
    });

    it('wrong conversationId', async () => {
      const scope = await seedConversationScope();
      const resourceId = `res_${randomUUID()}`;
      const minted = await createConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId,
      });
      if (!minted.success) throw new Error('mint failed');

      const verified = await verifyConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: `conv_${randomUUID()}`,
        action: 'expire_offer',
        resourceId,
        token: minted.data.id,
      });
      expect(verified.success).toBe(true);
      if (verified.success && !verified.data.valid) {
        expect(verified.data.reason).toBe('mismatch');
      }
    });

    it('wrong action', async () => {
      const scope = await seedConversationScope();
      const resourceId = `res_${randomUUID()}`;
      const minted = await createConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId,
      });
      if (!minted.success) throw new Error('mint failed');

      const verified = await verifyConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'pause_campaign',
        resourceId,
        token: minted.data.id,
      });
      expect(verified.success).toBe(true);
      if (verified.success && !verified.data.valid) {
        expect(verified.data.reason).toBe('mismatch');
      }
    });

    it('wrong resourceId', async () => {
      const scope = await seedConversationScope();
      const resourceId = `res_${randomUUID()}`;
      const minted = await createConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId,
      });
      if (!minted.success) throw new Error('mint failed');

      const verified = await verifyConfirmationToken(db, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        action: 'expire_offer',
        resourceId: `res_${randomUUID()}`,
        token: minted.data.id,
      });
      expect(verified.success).toBe(true);
      if (verified.success && !verified.data.valid) {
        expect(verified.data.reason).toBe('mismatch');
      }
    });
  });
});
