import type { Organization } from '@borradh-workspace/database';

export interface CancellationPolicy {
  /** Hours of notice the org requires for a free cancel/reschedule. */
  noticeRequiredHours: number;
  /** Whether the patient is still inside the free window. */
  isWithinFreeWindow: boolean;
  /**
   * The fee that applies if they proceed anyway, in cents. Null when the org
   * charges nothing — which is NOT the same as zero, and the UI must say
   * "free cancellation" rather than "€0.00 fee".
   */
  lateFeeCents: number | null;
}

/**
 * The single place the cancellation window is computed.
 *
 * Both cancel and reschedule consult this, because an org that requires 24h
 * notice means 24h for either — a patient who could dodge the fee by
 * rescheduling to next year and then cancelling for free has found the same
 * hole from the other side.
 *
 * Note we never BLOCK a late cancellation. A patient who cannot come is not
 * going to come because the button was disabled; refusing the cancel just turns
 * a recoverable slot into a no-show. We let it through and surface the fee.
 */
export const evaluateCancellationPolicy = (
  org: Pick<
    Organization,
    'reschedulingNoticeRequiredHours' | 'noShowOrLateCancelFeeCents'
  >,
  appointmentStart: Date,
  now: Date = new Date()
): CancellationPolicy => {
  const noticeRequiredHours = org.reschedulingNoticeRequiredHours ?? 24;

  const hoursUntil =
    (appointmentStart.getTime() - now.getTime()) / (60 * 60 * 1000);

  return {
    noticeRequiredHours,
    isWithinFreeWindow: hoursUntil >= noticeRequiredHours,
    lateFeeCents: org.noShowOrLateCancelFeeCents ?? null,
  };
};

// ---------------------------------------------------------------------------
// The single gate every customer-initiated cancel/reschedule passes through
// ---------------------------------------------------------------------------

/** What a customer is trying to do to an existing booking. */
export type BookingAction = 'cancel' | 'reschedule';

/** The org columns the decision reads. Accepts a partial row / null org. */
export type BookingPolicyOrg = Partial<
  Pick<
    Organization,
    | 'customerCancellationsEnabled'
    | 'customerReschedulingEnabled'
    | 'cancellationNoticeRequiredHours'
    | 'reschedulingNoticeRequiredHours'
    | 'noShowOrLateCancelFeeCents'
  >
> | null;

export interface BookingPolicyDecision {
  /**
   * False ONLY when the clinic has switched this action off online. The
   * notice window never sets this — see the note on blocking below.
   */
  allowed: boolean;
  /** Customer-facing reason when `allowed` is false; null otherwise. */
  deniedReason: string | null;
  /** Hours of notice the clinic asks for. 0 means no window at all. */
  noticeRequiredHours: number;
  /** Whether they are still inside the free window. */
  isWithinFreeWindow: boolean;
  /** Last instant still inside the free window; null when there is no window. */
  freeUntil: Date | null;
  /**
   * The fee the clinic STATES applies if they proceed late, in cents. Null
   * when the clinic charges nothing — not the same as zero, and the UI must
   * say "free cancellation" rather than "€0.00".
   *
   * Nothing in the product charges this today; it is communicated to the
   * customer and collected by the clinic. See the settings copy.
   */
  lateFeeCents: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The ONE place a customer-initiated cancel or reschedule is judged.
 *
 * Every entry point must call this: the portal services AND the token-based
 * `/book/:slug/manage/:token/*` endpoints reached from a confirmation email.
 * Before this existed the manage-token path consulted nothing, so a customer
 * holding any confirmation email could cancel however the clinic had
 * configured the policy — the settings were advisory in practice.
 *
 * WHY THE NOTICE WINDOW DOES NOT BLOCK
 * ------------------------------------
 * A patient who cannot come is not going to come because the button was
 * disabled. Refusing a late cancellation converts a slot the clinic could
 * still refill into a silent no-show, so it costs the clinic the slot AND the
 * notice. We let it through and surface the fee. The TOGGLES are different:
 * "this clinic does not offer online cancellation" is a real capability
 * statement, and those do block.
 *
 * ON THE FEE DODGE
 * ----------------
 * Reschedule far out (inside the window, no fee), then cancel the far-out
 * booking (also inside the window, no fee). Collapsing cancel and reschedule
 * onto ONE window — which this file used to argue for — does not actually
 * close that, because both steps are individually inside whatever single
 * window you pick. The real fix is to carry the ORIGINAL start through a
 * reschedule and judge the cancel against it, which needs a column to
 * remember it. Tracked separately; noted here so the next reader does not
 * re-derive the wrong fix.
 */
export const evaluateBookingPolicy = (
  org: BookingPolicyOrg,
  action: BookingAction,
  appointmentStart: Date,
  now: Date = new Date()
): BookingPolicyDecision => {
  // `?? true` / `?? 0` mirror the columns' NOT NULL defaults, so a row from
  // before the migration — or a partial test fixture, or a missing org —
  // behaves like the default rather than silently denying.
  const enabled =
    action === 'cancel'
      ? (org?.customerCancellationsEnabled ?? true)
      : (org?.customerReschedulingEnabled ?? true);

  const noticeRequiredHours =
    (action === 'cancel'
      ? org?.cancellationNoticeRequiredHours
      : org?.reschedulingNoticeRequiredHours) ?? 0;

  const freeUntil =
    noticeRequiredHours > 0
      ? new Date(appointmentStart.getTime() - noticeRequiredHours * HOUR_MS)
      : null;

  // At the deadline is ALLOWED; only strictly past it is late. Mirrored by
  // `canCancel`/`canReschedule` on the list response.
  const isWithinFreeWindow =
    freeUntil === null || now.getTime() <= freeUntil.getTime();

  return {
    allowed: enabled,
    deniedReason: enabled
      ? null
      : action === 'cancel'
        ? "This clinic doesn't allow online cancellations."
        : "This clinic doesn't allow online rescheduling.",
    noticeRequiredHours,
    isWithinFreeWindow,
    freeUntil,
    lateFeeCents: org?.noShowOrLateCancelFeeCents ?? null,
  };
};
