import { describe, expect, it, vi } from '@borradh-workspace/testing';
import { logFirstTouchOutcome } from './audit.js';

/**
 * The audit trail for Claire's opener.
 *
 * A skipped first touch opens no conversation, sends no message and leaves the
 * lead untouched — so before this row existed, a skip was invisible in SQL and
 * the PostHog event said `.success` either way (`ok({ sent: false })` is a
 * successful Result). This row is what makes "why has this clinic sent
 * nothing?" one query instead of log archaeology.
 */
const mockDb = () => {
  const values = vi.fn().mockResolvedValue(undefined);
  return { db: { insert: vi.fn(() => ({ values })) }, values };
};

describe('logFirstTouchOutcome', () => {
  it('records a skip against the lead, with the reason', async () => {
    const { db, values } = mockDb();

    await logFirstTouchOutcome(db as never, {
      organizationId: 'org-1',
      leadId: 'lead-1',
      channel: null,
      reason: 'chatbot_disabled',
      metadata: { smsBotOn: false },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'lead',
        entityId: 'lead-1',
        organizationId: 'org-1',
        actorType: 'system',
        metadata: expect.objectContaining({
          event: 'first_touch_skipped',
          reason: 'chatbot_disabled',
          channel: null,
          smsBotOn: false,
        }),
      })
    );
  });

  // The send is the point; the row is bookkeeping. They must be
  // distinguishable in SQL, so a delivered opener records the channel and no
  // reason — otherwise "sent" and "skipped" look alike again.
  it('records a send with its channel and no reason', async () => {
    const { db, values } = mockDb();

    await logFirstTouchOutcome(db as never, {
      organizationId: 'org-1',
      leadId: 'lead-1',
      channel: 'whatsapp',
      metadata: { conversationId: 'conv-1' },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          event: 'first_touch_sent',
          channel: 'whatsapp',
          reason: null,
          conversationId: 'conv-1',
        }),
      })
    );
  });

  // Telemetry must never cost the opener. A failing audit write is a lost row,
  // not a lost message — so this resolves rather than throwing into the caller.
  it('never throws when the audit write fails', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn().mockRejectedValue(new Error('audit insert exploded')),
      })),
    };

    await expect(
      logFirstTouchOutcome(db as never, {
        organizationId: 'org-1',
        leadId: 'lead-1',
        channel: 'sms',
      })
    ).resolves.toBeUndefined();
  });
});
