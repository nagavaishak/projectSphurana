import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { domainPairFor, validateMicrositeDomain } from './domain-name.js';

const original = process.env.MICROSITE_BASE_DOMAIN;

describe('validateMicrositeDomain', () => {
  beforeEach(() => {
    process.env.MICROSITE_BASE_DOMAIN = 'borradh.io,borradh-dev.com';
  });
  afterEach(() => {
    process.env.MICROSITE_BASE_DOMAIN = original ?? 'borradh.io';
  });

  it('normalises scheme, case, port, path and trailing dot to one spelling', () => {
    for (const raw of [
      'HTTPS://Salon.COM/pricing?x=1',
      'salon.com.',
      '  salon.com:443 ',
      'http://salon.com',
    ]) {
      const result = validateMicrositeDomain(raw);
      expect(result.valid, raw).toBe(true);
      if (!result.valid) continue;
      expect(result.value.domain).toBe('salon.com');
    }
  });

  it('punycode-normalises IDN so one host cannot become two rows', () => {
    const unicode = validateMicrositeDomain('caffè.ie');
    const ascii = validateMicrositeDomain('XN--CAFF-8OA.ie');

    expect(unicode.valid && ascii.valid).toBe(true);
    if (!unicode.valid || !ascii.valid) return;
    // The unique constraint sees one value, whichever spelling the tenant typed.
    expect(unicode.value.domain).toBe(ascii.value.domain);
    expect(unicode.value.domain).toBe('xn--caff-8oa.ie');
  });

  // ── The hijack the wildcard tier depends on ──────────────────────
  it('refuses our own apex and any label under it', () => {
    for (const raw of [
      'borradh.io',
      'acme.borradh.io',
      'www.borradh.io',
      'borradh-dev.com',
      'anything.borradh-dev.com',
      'HTTPS://Acme.Borradh.IO/',
    ]) {
      const result = validateMicrositeDomain(raw);
      expect(result.valid, raw).toBe(false);
      if (result.valid) continue;
      expect(result.reason).toBe('own_apex');
    }
  });

  it('refuses IP literals, v4 and v6', () => {
    for (const raw of ['127.0.0.1', '76.76.21.21', '[::1]', '2001:db8::1']) {
      const result = validateMicrositeDomain(raw);
      expect(result.valid, raw).toBe(false);
      if (result.valid) continue;
      expect(result.reason).toBe('ip_address');
    }
  });

  it('refuses single labels and non-public suffixes', () => {
    expect(validateMicrositeDomain('salon')).toMatchObject({
      valid: false,
      reason: 'single_label',
    });
    for (const raw of ['salon.local', 'box.internal', 'thing.test']) {
      const result = validateMicrositeDomain(raw);
      expect(result.valid, raw).toBe(false);
      if (result.valid) continue;
      expect(result.reason).toBe('reserved_suffix');
    }
  });

  it('refuses malformed labels', () => {
    for (const raw of [
      '-salon.com',
      'salon-.com',
      'sa lon.com',
      'salon..com',
    ]) {
      expect(validateMicrositeDomain(raw).valid, raw).toBe(false);
    }
  });

  it('marks two-label and known multi-part-suffix names as apexes', () => {
    for (const [raw, apex] of [
      ['salon.com', true],
      ['salon.ie', true],
      ['salon.co.uk', true],
      ['book.salon.com', false],
      ['book.salon.co.uk', false],
    ] as const) {
      const result = validateMicrositeDomain(raw);
      expect(result.valid, raw).toBe(true);
      if (!result.valid) continue;
      expect(result.value.isApex, raw).toBe(apex);
    }
  });
});

describe('domainPairFor', () => {
  it('provisions the apex and its www sibling', () => {
    const result = validateMicrositeDomain('salon.com');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(domainPairFor(result.value)).toEqual({
      canonical: 'salon.com',
      alias: 'www.salon.com',
    });
  });

  it('canonicalises a www input to the apex so the pair is the same either way', () => {
    const typed = validateMicrositeDomain('www.salon.com');
    expect(typed.valid).toBe(true);
    if (!typed.valid) return;
    expect(domainPairFor(typed.value)).toEqual({
      canonical: 'salon.com',
      alias: 'www.salon.com',
    });
  });

  it('does not invent a www sibling for a real subdomain', () => {
    const result = validateMicrositeDomain('book.salon.com');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(domainPairFor(result.value)).toEqual({
      canonical: 'book.salon.com',
      alias: null,
    });
  });
});
