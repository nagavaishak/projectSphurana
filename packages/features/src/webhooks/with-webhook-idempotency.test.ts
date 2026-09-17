import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withWebhookIdempotency } from './with-webhook-idempotency.js';

const returning = vi.fn();
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning,
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

/** The ledger claim won: this is the first delivery. */
const claimWins = () => returning.mockResolvedValueOnce([{ eventId: 'evt_1' }]);
/** The ledger claim lost: the event was already applied. */
const claimLoses = () => returning.mockResolvedValueOnce([]);

describe('withWebhookIdempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies the effects on first delivery', async () => {
    claimWins();
    const apply = vi.fn().mockResolvedValue({ processed: true });

    const outcome = await withWebhookIdempotency(
      mockDb as never,
      'stripe_connect',
      'evt_1',
      apply
    );

    expect(apply).toHaveBeenCalledTimes(1);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.result).toEqual({ processed: true });
    expect(mockDb.values).toHaveBeenCalledWith({
      provider: 'stripe_connect',
      eventId: 'evt_1',
    });
  });

  it('SKIPS the effects on a replay — Stripe retries on any non-2xx', async () => {
    claimLoses();
    const apply = vi.fn();

    const outcome = await withWebhookIdempotency(
      mockDb as never,
      'stripe_connect',
      'evt_1',
      apply
    );

    expect(apply).not.toHaveBeenCalled();
    expect(outcome.duplicate).toBe(true);
  });

  it('releases the claim when the handler throws, so the retry can re-apply', async () => {
    claimWins();
    const apply = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      withWebhookIdempotency(mockDb as never, 'stripe_connect', 'evt_1', apply)
    ).rejects.toThrow('boom');

    // The poison marker must NOT survive a transient failure, or Stripe's
    // redelivery would be silently swallowed as a duplicate.
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });

  it('keys the ledger per provider — one Stripe event id is not global across accounts', async () => {
    claimWins();
    await withWebhookIdempotency(
      mockDb as never,
      'stripe_billing',
      'evt_9',
      vi.fn().mockResolvedValue(null)
    );
    expect(mockDb.values).toHaveBeenCalledWith({
      provider: 'stripe_billing',
      eventId: 'evt_9',
    });
  });
});
