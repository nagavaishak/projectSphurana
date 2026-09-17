import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySvixSignature } from './svix-signature.js';

const SECRET_RAW = randomBytes(24); // Svix secrets are base64-encoded bytes
const SECRET = `whsec_${SECRET_RAW.toString('base64')}`;
const ID = 'msg_2abc';
const TIMESTAMP = '1700000000';
/** Pin the clock to TIMESTAMP so the ±300s replay window is satisfied. */
const NOW_MS = Number(TIMESTAMP) * 1000;
const PAYLOAD = JSON.stringify({
  type: 'email.bounced',
  data: { email_id: 'e1' },
});

/** Reference implementation of Svix's v1 signature for the test. */
function sign(
  secretRaw: Buffer,
  id: string,
  timestamp: string,
  payload: string
): string {
  const signed = `${id}.${timestamp}.${payload}`;
  const sig = createHmac('sha256', secretRaw)
    .update(signed, 'utf8')
    .digest('base64');
  return `v1,${sig}`;
}

describe('verifySvixSignature', () => {
  it('accepts a correctly-signed payload', () => {
    const signature = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it('accepts when the header carries multiple space-separated signatures', () => {
    const good = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    const signature = `v1,bogussignature ${good}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it('works with a bare secret (no whsec_ prefix)', () => {
    const signature = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET_RAW.toString('base64'),
        id: ID,
        timestamp: TIMESTAMP,
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signature = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature,
        payload: JSON.stringify({ type: 'email.delivered' }),
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects a wrong signature', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature: 'v1,d3JvbmdzaWduYXR1cmU=',
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects when signed by a different secret', () => {
    const otherSecret = randomBytes(24);
    const signature = sign(otherSecret, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects when required headers are missing', () => {
    const signature = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: undefined,
        timestamp: TIMESTAMP,
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it('rejects when the timestamp is changed (part of signed content)', () => {
    const signature = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: '1700009999',
        signature,
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });
  // --- replay window ------------------------------------------------------
  // The signature is VALID in every case below; the only variable is the clock.
  // Signing at a timestamp other than the one in the header would fail on the
  // digest instead and would prove nothing about the window.
  const validSig = sign(SECRET_RAW, ID, TIMESTAMP, PAYLOAD);
  const at = (nowMs: number) =>
    verifySvixSignature({
      secret: SECRET,
      id: ID,
      timestamp: TIMESTAMP,
      signature: validSig,
      payload: PAYLOAD,
      nowMs,
    });

  it('accepts a timestamp inside the ±300s window, each way', () => {
    expect(at(NOW_MS)).toBe(true);
    expect(at(NOW_MS + 299_000)).toBe(true);
    expect(at(NOW_MS - 299_000)).toBe(true);
  });

  it('rejects a stale timestamp — a captured delivery is not replayable forever', () => {
    expect(at(NOW_MS + 301_000)).toBe(false);
    expect(at(NOW_MS + 365 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('rejects a far-FUTURE timestamp — a past-only window is half a check', () => {
    expect(at(NOW_MS - 301_000)).toBe(false);
    expect(at(NOW_MS - 365 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('rejects a non-numeric timestamp rather than letting NaN through', () => {
    // Number('nope') is NaN and every comparison against NaN is false, so an
    // arithmetic-only window check would ACCEPT this.
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: 'not-a-number',
        signature: sign(SECRET_RAW, ID, 'not-a-number', PAYLOAD),
        payload: PAYLOAD,
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it('honours an explicit toleranceSeconds override', () => {
    const tight = (nowMs: number) =>
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signature: validSig,
        payload: PAYLOAD,
        toleranceSeconds: 10,
        nowMs,
      });
    expect(tight(NOW_MS + 9_000)).toBe(true);
    expect(tight(NOW_MS + 11_000)).toBe(false);
  });
});
