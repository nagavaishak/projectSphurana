import { describe, expect, it } from '@borradh-workspace/testing';
import { pathTierLinkTarget } from '../../shared/index.js';
import {
  MANAGE_TOKEN_GRACE_DAYS,
  buildManageBookingUrl,
  generateManageToken,
  hashManageToken,
  manageTokenExpiryFor,
} from './manage-token.js';

describe('generateManageToken', () => {
  it('is unguessable — 256 bits, URL-safe, never repeating', () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateManageToken())
    );

    // No collisions. A repeat would mean one patient could manage another's
    // booking, so this is the whole security property in one assertion.
    expect(tokens.size).toBe(500);

    for (const token of tokens) {
      // base64url of 32 bytes — no +, /, or = to be mangled by a mail client.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('hashManageToken', () => {
  it('is deterministic, so a link keeps working across requests', () => {
    const token = generateManageToken();
    expect(hashManageToken(token)).toBe(hashManageToken(token));
  });

  it('never returns the raw token — a DB dump must not yield working links', () => {
    const token = generateManageToken();
    const hash = hashManageToken(token);

    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates distinct tokens', () => {
    expect(hashManageToken('a')).not.toBe(hashManageToken('b'));
  });
});

describe('manageTokenExpiryFor', () => {
  it('outlives the appointment, so a no-show sees an explanation not a 404', () => {
    const end = new Date('2026-03-15T10:30:00Z');

    const expiry = manageTokenExpiryFor(end);

    expect(expiry.getTime()).toBeGreaterThan(end.getTime());
    expect(expiry.getTime() - end.getTime()).toBe(
      MANAGE_TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000
    );
  });
});

describe('buildManageBookingUrl', () => {
  it('percent-encodes the token so a mail client cannot truncate the path', () => {
    // base64url never produces these, but the encoder is what guarantees that
    // a future token format change cannot silently break every link in flight.
    const url = buildManageBookingUrl(
      pathTierLinkTarget('glow-aesthetics'),
      'a/b+c=d'
    );

    // Booking moved onto the microsite: /sites/{slug}/book/manage/{token}.
    // Pinned as a FULL url, host included — a builder that composed the right
    // path onto the wrong host is exactly the ENG-770 failure, and a substring
    // assertion would have passed straight through it.
    expect(url).toBe(
      `https://mock-marketing.example.com/sites/glow-aesthetics/book/manage/${encodeURIComponent(
        'a/b+c=d'
      )}`
    );
    expect(url).not.toContain('a/b+c=d');
  });

  it('puts the token in the path, never a query string', () => {
    const url = buildManageBookingUrl(pathTierLinkTarget('glow'), 'tok123');

    // A token in a query string leaks via Referer headers and access logs.
    expect(url).not.toContain('?');
    expect(url).toBe(
      'https://mock-marketing.example.com/sites/glow/book/manage/tok123'
    );
  });

  it("uses the tenant's own host, with no /sites/ segment, once their domain is live", () => {
    const url = buildManageBookingUrl(
      { organizationSlug: 'glow', primaryDomain: 'glowaesthetics.ie' },
      'tok123'
    );

    expect(url).toBe('https://glowaesthetics.ie/book/manage/tok123');
    expect(url).not.toContain('/sites/');
    expect(url).not.toContain('mock-web.example.com');
  });
});
