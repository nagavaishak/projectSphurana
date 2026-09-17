import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type BookingPolicyOrg,
  evaluateBookingPolicy,
  evaluateCancellationPolicy,
} from './cancellation-policy.js';

const org = (overrides?: {
  reschedulingNoticeRequiredHours?: number | null;
  noShowOrLateCancelFeeCents?: number | null;
}) => ({
  reschedulingNoticeRequiredHours:
    overrides?.reschedulingNoticeRequiredHours ?? 24,
  noShowOrLateCancelFeeCents: overrides?.noShowOrLateCancelFeeCents ?? null,
});

const now = new Date('2026-03-15T10:00:00Z');
const hoursFromNow = (h: number) =>
  new Date(now.getTime() + h * 60 * 60 * 1000);

describe('evaluateCancellationPolicy', () => {
  it('is inside the free window with more notice than required', () => {
    const policy = evaluateCancellationPolicy(org(), hoursFromNow(48), now);

    expect(policy.isWithinFreeWindow).toBe(true);
    expect(policy.noticeRequiredHours).toBe(24);
  });

  it('is outside the free window with less notice than required', () => {
    const policy = evaluateCancellationPolicy(org(), hoursFromNow(3), now);

    expect(policy.isWithinFreeWindow).toBe(false);
  });

  it('treats exactly-the-notice-window as free — the boundary favours the patient', () => {
    const policy = evaluateCancellationPolicy(org(), hoursFromNow(24), now);

    expect(policy.isWithinFreeWindow).toBe(true);
  });

  it('is outside the window for an appointment already in the past', () => {
    const policy = evaluateCancellationPolicy(org(), hoursFromNow(-1), now);

    expect(policy.isWithinFreeWindow).toBe(false);
  });

  it('defaults to 24h when the org has not set a notice period', () => {
    const policy = evaluateCancellationPolicy(
      org({ reschedulingNoticeRequiredHours: null }),
      hoursFromNow(30),
      now
    );

    expect(policy.noticeRequiredHours).toBe(24);
    expect(policy.isWithinFreeWindow).toBe(true);
  });

  it('reports NO fee as null, not zero', () => {
    // The distinction is load-bearing: the UI must say "free cancellation",
    // not "a €0.00 fee may apply".
    const policy = evaluateCancellationPolicy(
      org({ noShowOrLateCancelFeeCents: null }),
      hoursFromNow(1),
      now
    );

    expect(policy.lateFeeCents).toBeNull();
  });

  it('reports the org fee when one is configured', () => {
    const policy = evaluateCancellationPolicy(
      org({ noShowOrLateCancelFeeCents: 2500 }),
      hoursFromNow(1),
      now
    );

    expect(policy.lateFeeCents).toBe(2500);
    expect(policy.isWithinFreeWindow).toBe(false);
  });

  it('uses a custom notice window when the org sets one', () => {
    const policy = evaluateCancellationPolicy(
      org({ reschedulingNoticeRequiredHours: 72 }),
      hoursFromNow(48),
      now
    );

    // 48h notice is generous by default, but this org demands 72.
    expect(policy.isWithinFreeWindow).toBe(false);
    expect(policy.noticeRequiredHours).toBe(72);
  });
});

/**
 * The gate every customer-initiated cancel/reschedule passes through — the
 * portal services AND the token-based manage endpoints reached from a
 * confirmation email. Before it existed the manage path consulted nothing, so
 * the clinic's settings were advisory for anyone holding one of those emails.
 */
describe('evaluateBookingPolicy', () => {
  const policyOrg = (overrides: Partial<BookingPolicyOrg & object> = {}) => ({
    customerCancellationsEnabled: true,
    customerReschedulingEnabled: true,
    cancellationNoticeRequiredHours: 24,
    reschedulingNoticeRequiredHours: 12,
    noShowOrLateCancelFeeCents: 2500,
    ...overrides,
  });

  describe('the toggle is the only thing that blocks', () => {
    it('denies a cancel when the clinic has switched it off', () => {
      const d = evaluateBookingPolicy(
        policyOrg({ customerCancellationsEnabled: false }),
        'cancel',
        hoursFromNow(48),
        now
      );

      expect(d.allowed).toBe(false);
      expect(d.deniedReason).toBe(
        "This clinic doesn't allow online cancellations."
      );
    });

    it('denies a reschedule when the clinic has switched it off', () => {
      const d = evaluateBookingPolicy(
        policyOrg({ customerReschedulingEnabled: false }),
        'reschedule',
        hoursFromNow(48),
        now
      );

      expect(d.allowed).toBe(false);
      expect(d.deniedReason).toBe(
        "This clinic doesn't allow online rescheduling."
      );
    });

    it('does not let one toggle affect the other action', () => {
      const org = policyOrg({ customerCancellationsEnabled: false });

      expect(
        evaluateBookingPolicy(org, 'cancel', hoursFromNow(48), now).allowed
      ).toBe(false);
      expect(
        evaluateBookingPolicy(org, 'reschedule', hoursFromNow(48), now).allowed
      ).toBe(true);
    });
  });

  /**
   * A patient who cannot come is not going to come because the button was
   * disabled. Refusing a late cancellation converts a slot the clinic could
   * still refill into a silent no-show — it costs them the slot AND the
   * notice. So the window reports a fee; it never denies.
   */
  describe('the notice window never blocks', () => {
    it.each([
      ['cancel', 48, true],
      ['cancel', 1, false],
      ['reschedule', 48, true],
      ['reschedule', 1, false],
    ] as const)(
      '%s %ih out is always allowed (free window: %s)',
      (action, hoursOut, expectedFree) => {
        const d = evaluateBookingPolicy(
          policyOrg(),
          action,
          hoursFromNow(hoursOut),
          now
        );

        expect(d.allowed).toBe(true);
        expect(d.isWithinFreeWindow).toBe(expectedFree);
      }
    );

    it('reports the clinic fee once outside the free window', () => {
      const d = evaluateBookingPolicy(
        policyOrg(),
        'cancel',
        hoursFromNow(1),
        now
      );

      expect(d.isWithinFreeWindow).toBe(false);
      expect(d.lateFeeCents).toBe(2500);
    });

    it('reports null — not zero — when the clinic charges nothing', () => {
      const d = evaluateBookingPolicy(
        policyOrg({ noShowOrLateCancelFeeCents: null }),
        'cancel',
        hoursFromNow(1),
        now
      );

      expect(d.lateFeeCents).toBeNull();
    });
  });

  describe('window selection', () => {
    it('judges a cancel against the CANCELLATION window', () => {
      // 24h cancel window, 12h reschedule window, booking 18h out: late to
      // cancel, still inside the reschedule window. Reading the wrong column
      // is exactly how the emailed link and the portal came to disagree.
      const d = evaluateBookingPolicy(
        policyOrg(),
        'cancel',
        hoursFromNow(18),
        now
      );

      expect(d.noticeRequiredHours).toBe(24);
      expect(d.isWithinFreeWindow).toBe(false);
    });

    it('judges a reschedule against the RESCHEDULING window', () => {
      const d = evaluateBookingPolicy(
        policyOrg(),
        'reschedule',
        hoursFromNow(18),
        now
      );

      expect(d.noticeRequiredHours).toBe(12);
      expect(d.isWithinFreeWindow).toBe(true);
    });

    it('treats exactly at the deadline as still free', () => {
      const d = evaluateBookingPolicy(
        policyOrg(),
        'cancel',
        hoursFromNow(24),
        now
      );

      expect(d.isWithinFreeWindow).toBe(true);
    });

    it('has no window, and so no deadline, at 0 hours', () => {
      const d = evaluateBookingPolicy(
        policyOrg({ cancellationNoticeRequiredHours: 0 }),
        'cancel',
        hoursFromNow(0.1),
        now
      );

      expect(d.isWithinFreeWindow).toBe(true);
      expect(d.freeUntil).toBeNull();
    });
  });

  /**
   * A missing org, or a row written before the policy columns existed, must
   * behave like the NOT NULL defaults rather than silently denying every
   * customer their own booking.
   */
  it('defaults to permissive for a null org', () => {
    const d = evaluateBookingPolicy(null, 'cancel', hoursFromNow(1), now);

    expect(d.allowed).toBe(true);
    expect(d.noticeRequiredHours).toBe(0);
    expect(d.lateFeeCents).toBeNull();
  });
});
