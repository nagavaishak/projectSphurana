import { describe, expect, it } from '@borradh-workspace/testing';
import { signTrackingToken, verifyTrackingToken } from './tracking-token.js';

const secret = 'test-secret-key';

describe('tracking-token', () => {
  it('round-trips a signed payload', () => {
    const token = signTrackingToken(
      { r: 'rcpt_1', c: 'email', t: 'https://example.com/book' },
      secret
    );
    const decoded = verifyTrackingToken(token, secret);
    expect(decoded).toEqual({
      r: 'rcpt_1',
      c: 'email',
      t: 'https://example.com/book',
    });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signTrackingToken({ r: 'rcpt_1', c: 'sms' }, secret);
    expect(verifyTrackingToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signTrackingToken({ r: 'rcpt_1', c: 'email' }, secret);
    const [, sig] = token.split('.');
    const forged = `${signTrackingToken({ r: 'attacker', c: 'email' }, 'x').split('.')[0]}.${sig}`;
    expect(verifyTrackingToken(forged, secret)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyTrackingToken('garbage', secret)).toBeNull();
    expect(verifyTrackingToken('', secret)).toBeNull();
    expect(verifyTrackingToken('a.b.c', secret)).toBeNull();
  });
});
