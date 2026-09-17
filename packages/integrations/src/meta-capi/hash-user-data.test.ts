/**
 * Known input → known digest. These constants are the whole test: a
 * normalisation slip (a stray space, a kept `+`, a missed lowercase) produces
 * a perfectly valid hash that matches nobody, and Meta reports that as
 * "accepted". Nothing downstream can catch it, so it is caught here.
 */

import { describe, expect, it } from 'vitest';
import { hasMatchKey, hashUserData } from './hash-user-data.js';

const EMAIL_DIGEST =
  '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b'; // sha256('test@example.com')
const PHONE_DIGEST =
  '05dcf125001856bf024e2a2ffe598e8f89f1b9c056c770dbb69b81d1be7d25c7'; // sha256('353851234567')
const FIRST_NAME_DIGEST =
  '81f8f6dde88365f3928796ec7aa53f72820b06db8664f5fe76a7eb13e24546a2'; // sha256('jane')
const LAST_NAME_DIGEST =
  '7a0fbfdf40cbeb97429bdb88f512cecd27f0d44b7e57986ab578423bb61936ac'; // sha256('oconnor')
const CITY_DIGEST =
  '057d11446d7249dcbc77fa8af283768f575d4f35f8dd86dbc332fb4d690c28bb'; // sha256('dublin')

describe('hashUserData', () => {
  it('lowercases and trims email before hashing', () => {
    expect(hashUserData({ email: '  Test@Example.COM ' }).em).toEqual([
      EMAIL_DIGEST,
    ]);
  });

  it('strips phone formatting and the leading + but keeps the country code', () => {
    for (const phone of [
      '+353 85 123 4567',
      '00353851234567',
      '(353) 85-123-4567',
    ]) {
      expect(hashUserData({ phone }).ph).toEqual([PHONE_DIGEST]);
    }
  });

  it('strips punctuation and case from names and city', () => {
    const hashed = hashUserData({
      firstName: ' Jane ',
      lastName: "O'Connor",
      city: 'Dublin ',
    });
    expect(hashed.fn).toEqual([FIRST_NAME_DIGEST]);
    expect(hashed.ln).toEqual([LAST_NAME_DIGEST]);
    expect(hashed.ct).toEqual([CITY_DIGEST]);
  });

  it('normalises country, gender and date of birth', () => {
    const hashed = hashUserData({
      country: 'IE',
      gender: 'Female',
      dateOfBirth: '1990-04-07',
    });
    expect(hashed.country).toEqual([
      hashUserData({ country: 'ie' }).country?.[0],
    ]);
    expect(hashed.ge).toEqual([hashUserData({ gender: 'f' }).ge?.[0]]);
    expect(hashed.db).toEqual([
      hashUserData({ dateOfBirth: '19900407' }).db?.[0],
    ]);
  });

  it('omits blank fields rather than hashing the empty string', () => {
    const hashed = hashUserData({ email: '   ', phone: null, firstName: '' });
    expect(hashed).not.toHaveProperty('em');
    expect(hashed).not.toHaveProperty('ph');
    expect(hashed).not.toHaveProperty('fn');
  });

  it('passes the browser signals through UNHASHED, as Meta requires', () => {
    const hashed = hashUserData({
      clientIpAddress: '203.0.113.7',
      clientUserAgent: 'Mozilla/5.0',
      fbc: 'fb.1.1700000000.AbCd',
      fbp: 'fb.1.1700000000.987654321',
    });
    expect(hashed.client_ip_address).toBe('203.0.113.7');
    expect(hashed.client_user_agent).toBe('Mozilla/5.0');
    expect(hashed.fbc).toBe('fb.1.1700000000.AbCd');
    expect(hashed.fbp).toBe('fb.1.1700000000.987654321');
  });

  it('reports whether Meta has anything to match on', () => {
    expect(hasMatchKey(hashUserData({ email: 'a@b.com' }))).toBe(true);
    expect(hasMatchKey(hashUserData({ fbp: 'fb.1.2.3' }))).toBe(true);
    expect(hasMatchKey(hashUserData({ city: 'Dublin' }))).toBe(false);
  });
});
