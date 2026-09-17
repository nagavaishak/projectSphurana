import { describe, expect, it } from '@borradh-workspace/testing';
import { patientSessionTtlMs } from './sign-in.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a portal session lasts depends on HOW the customer proved who they
 * were — the decision this file exists to pin.
 *
 * An OTP means they read a code out of the mailbox at that moment: mailbox
 * control proven now. A magic link means they clicked something that had been
 * sitting in an inbox, possibly forwarded to a partner, read from a shared
 * family mailbox, or pulled out of a backup. The two are not equivalent proof,
 * so they must not buy equivalent access to a medical-adjacent record.
 *
 * Whether the session ROW is actually shortened (Better Auth stamps its own
 * instance-level expiry, which finalizePatientSignIn has to overwrite) belongs
 * to the API integration suite, where a real session can be read back.
 */
describe('patientSessionTtlMs', () => {
  it('gives an OTP sign-in the full 30 days', () => {
    expect(patientSessionTtlMs('otp')).toBe(30 * DAY_MS);
  });

  it('gives a magic-link sign-in 7 days', () => {
    expect(patientSessionTtlMs('magic-link')).toBe(7 * DAY_MS);
  });

  it('never gives a magic link as much as an OTP', () => {
    // The relationship, not the constants — this is what must hold if either
    // number is ever retuned.
    expect(patientSessionTtlMs('magic-link')).toBeLessThan(
      patientSessionTtlMs('otp')
    );
  });
});
