import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTwilioSignature } from './twilio-signature.js';

/** Reference implementation of Twilio's signing algorithm for the test. */
function sign(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

const AUTH_TOKEN = 'test_auth_token_12345';
const URL = 'https://api.borradh.io/webhooks/twilio/sms';
const PARAMS = {
  From: '+15551234567',
  To: '+15559876543',
  Body: 'STOP',
  MessageSid: 'SM123',
};

describe('validateTwilioSignature', () => {
  it('accepts a correctly-signed request', () => {
    const signature = sign(AUTH_TOKEN, URL, PARAMS);
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url: URL,
        params: PARAMS,
      })
    ).toBe(true);
  });

  it('rejects a forged/incorrect signature', () => {
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature: 'Zm9yZ2VkIHNpZ25hdHVyZQ==',
        url: URL,
        params: PARAMS,
      })
    ).toBe(false);
  });

  it('rejects when a param is tampered with after signing', () => {
    const signature = sign(AUTH_TOKEN, URL, PARAMS);
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url: URL,
        params: { ...PARAMS, Body: 'START' }, // attacker flips STOP -> START
      })
    ).toBe(false);
  });

  it('rejects when the URL differs from what was signed', () => {
    const signature = sign(AUTH_TOKEN, URL, PARAMS);
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url: 'https://evil.example.com/webhooks/twilio/sms',
        params: PARAMS,
      })
    ).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature: undefined,
        url: URL,
        params: PARAMS,
      })
    ).toBe(false);
  });

  it('rejects when no auth token is provided', () => {
    const signature = sign(AUTH_TOKEN, URL, PARAMS);
    expect(
      validateTwilioSignature({
        authToken: '',
        signature,
        url: URL,
        params: PARAMS,
      })
    ).toBe(false);
  });

  it('is order-independent across params (sorts by key)', () => {
    const signature = sign(AUTH_TOKEN, URL, PARAMS);
    const reordered = {
      MessageSid: 'SM123',
      Body: 'STOP',
      To: '+15559876543',
      From: '+15551234567',
    };
    expect(
      validateTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url: URL,
        params: reordered,
      })
    ).toBe(true);
  });
});
