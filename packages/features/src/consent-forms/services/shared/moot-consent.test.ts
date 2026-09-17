import { describe, expect, it } from '@borradh-workspace/testing';
import { isPendingFormMoot } from './moot-consent.js';

describe('isPendingFormMoot', () => {
  const live = { status: 'booked' as const, deletedAt: null };
  const cancelled = { status: 'cancelled' as const, deletedAt: null };

  it('hides a pending form whose appointment was cancelled', () => {
    expect(isPendingFormMoot('pending', cancelled)).toBe(true);
  });

  it('hides a pending form whose appointment was soft-deleted', () => {
    expect(
      isPendingFormMoot('pending', {
        status: 'booked',
        deletedAt: new Date('2026-08-20T10:00:00Z'),
      })
    ).toBe(true);
  });

  it('keeps a pending form on a live appointment', () => {
    expect(isPendingFormMoot('pending', live)).toBe(false);
  });

  it('keeps a COMPLETED form even when the appointment was cancelled', () => {
    // An executed consent is a legal record: the patient keeps seeing and
    // downloading what they signed, whatever later happens to the booking.
    expect(isPendingFormMoot('completed', cancelled)).toBe(false);
  });

  it.each(['no_show', 'completed', 'arrived', 'started', 'held'] as const)(
    'keeps a pending form on a %s appointment',
    (status) => {
      // Only `cancelled` is mooting. These all describe a visit that reached
      // its slot — an unsigned form there is a compliance gap to chase, not
      // noise to hide.
      expect(isPendingFormMoot('pending', { status, deletedAt: null })).toBe(
        false
      );
    }
  );

  it('treats an unreadable appointment as live rather than hiding the form', () => {
    // Failing open here is deliberate: a form vanishing because a row could
    // not be loaded means a patient is silently never asked to consent.
    expect(isPendingFormMoot('pending', undefined)).toBe(false);
  });
});
