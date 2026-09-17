import { describe, expect, it } from 'vitest';
import {
  bindOrgToMagicToken,
  unbindOrgFromMagicToken,
} from './magic-link-binding.js';

/**
 * This binding is the ONLY thing standing between a magic link minted for
 * clinic A and that person's records at clinic B.
 *
 * A Better Auth magic-link token is bound to the EMAIL and nothing else, so it
 * identifies the person but not the clinic. A customer can be a patient at two
 * clinics — the `customer_account` is universal by design — so a bare BA token
 * replayed with `X-Portal-Org: B` would sign them in at B without ever proving
 * they own that mailbox for B's purposes. The org is therefore signed INTO the
 * token, and `verifyMagicLink` takes the org from here rather than from the
 * client-supplied slug.
 *
 * Everything below is the real implementation: pure crypto over the real
 * HMAC, no stubs. A mock that re-implemented this would prove nothing.
 */
describe('magic-link org binding', () => {
  const TOKEN = 'ba-token-abc123';
  const ORG_A = 'org_aaa';
  const ORG_B = 'org_bbb';

  it('round-trips the token and its org', () => {
    const composite = bindOrgToMagicToken(TOKEN, ORG_A);

    expect(unbindOrgFromMagicToken(composite)).toEqual({
      baToken: TOKEN,
      organizationId: ORG_A,
    });
  });

  it('does not leave the org readable as a bare, swappable field', () => {
    // The org IS present in the composite — this is a signature, not
    // encryption. What matters is that changing it invalidates the whole
    // thing, which the next test pins.
    expect(bindOrgToMagicToken(TOKEN, ORG_A)).toContain(ORG_A);
  });

  it('REJECTS a token whose org has been swapped', () => {
    // The attack: take a link legitimately minted for clinic A and edit the
    // org to clinic B, where the same person is also a patient.
    const composite = bindOrgToMagicToken(TOKEN, ORG_A);
    const tampered = composite.replace(ORG_A, ORG_B);

    expect(tampered).not.toBe(composite);
    expect(unbindOrgFromMagicToken(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const composite = bindOrgToMagicToken(TOKEN, ORG_A);
    const [token, org, sig] = composite.split('.');
    const flipped = `${sig.slice(0, -1)}${sig.at(-1) === 'a' ? 'b' : 'a'}`;

    expect(unbindOrgFromMagicToken(`${token}.${org}.${flipped}`)).toBeNull();
  });

  it('rejects a signature of the wrong length rather than throwing', () => {
    // timingSafeEqual THROWS on unequal lengths, so the length guard is
    // load-bearing: without it a truncated signature is a 500, not a refusal.
    const composite = bindOrgToMagicToken(TOKEN, ORG_A);
    const [token, org] = composite.split('.');

    expect(unbindOrgFromMagicToken(`${token}.${org}.deadbeef`)).toBeNull();
  });

  it('rejects a composite with too few parts', () => {
    expect(unbindOrgFromMagicToken('')).toBeNull();
    expect(unbindOrgFromMagicToken('only-one-part')).toBeNull();
    expect(unbindOrgFromMagicToken('two.parts')).toBeNull();
  });

  it('rejects an unsigned token pasted in directly', () => {
    // The pre-binding shape: a raw BA token with no org and no signature.
    expect(unbindOrgFromMagicToken(TOKEN)).toBeNull();
  });

  /**
   * The separator is `.` and a BA token may itself contain one, so unbinding
   * takes the LAST two dot-segments and rejoins the rest. If that ever
   * regressed to a naive 3-way split, links would break for exactly the
   * tokens that happen to contain a dot — an intermittent failure that would
   * be miserable to diagnose.
   */
  it('round-trips a token containing the separator', () => {
    const dotted = 'ba.token.with.dots';
    const composite = bindOrgToMagicToken(dotted, ORG_A);

    expect(unbindOrgFromMagicToken(composite)).toEqual({
      baToken: dotted,
      organizationId: ORG_A,
    });
  });

  it('binds two orgs to different signatures for the same token', () => {
    const a = bindOrgToMagicToken(TOKEN, ORG_A);
    const b = bindOrgToMagicToken(TOKEN, ORG_B);

    expect(a).not.toBe(b);
    expect(unbindOrgFromMagicToken(a)?.organizationId).toBe(ORG_A);
    expect(unbindOrgFromMagicToken(b)?.organizationId).toBe(ORG_B);
  });
});
