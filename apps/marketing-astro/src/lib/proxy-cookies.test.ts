import { describe, expect, it } from 'vitest';

import { rescopeCookieForHost } from './proxy-cookies';

const PROD_SESSION =
  'borradh_patient_session=abc123; Path=/; Domain=.borradh.io; SameSite=Lax; Secure; HttpOnly';

describe('rescopeCookieForHost', () => {
  it('strips Domain when the host does not match — the tenant-domain case', () => {
    // The bug this exists for: served from salon.com, a Domain=.borradh.io
    // cookie is rejected outright and portal sign-in silently fails.
    const result = rescopeCookieForHost(PROD_SESSION, 'salon.com');

    expect(result).not.toMatch(/Domain=/i);
    // Everything else must survive — dropping Secure or HttpOnly here would
    // downgrade the session cookie while appearing to work.
    expect(result).toContain('borradh_patient_session=abc123');
    expect(result).toContain('SameSite=Lax');
    expect(result).toContain('Secure');
    expect(result).toContain('HttpOnly');
    expect(result).toContain('Path=/');
  });

  it('keeps Domain when the host is under it (app.borradh.io is untouched)', () => {
    expect(rescopeCookieForHost(PROD_SESSION, 'app.borradh.io')).toBe(
      PROD_SESSION
    );
  });

  it('keeps Domain on an exact host match', () => {
    expect(rescopeCookieForHost(PROD_SESSION, 'borradh.io')).toBe(PROD_SESSION);
  });

  it('keeps Domain for a microsite on the wildcard tier', () => {
    expect(rescopeCookieForHost(PROD_SESSION, 'glow-clinic.borradh.io')).toBe(
      PROD_SESSION
    );
  });

  it('does NOT treat a lookalike host as a match', () => {
    // `notborradh.io`.endsWith('borradh.io') is true — a suffix check without a
    // label boundary would leave the Domain in place, and the browser would
    // then reject the cookie. Same failure, harder to spot.
    const result = rescopeCookieForHost(PROD_SESSION, 'notborradh.io');
    expect(result).not.toMatch(/Domain=/i);
  });

  it('ignores the port when comparing', () => {
    expect(rescopeCookieForHost(PROD_SESSION, 'app.borradh.io:4321')).toBe(
      PROD_SESSION
    );
  });

  it('compares case-insensitively', () => {
    expect(rescopeCookieForHost(PROD_SESSION, 'APP.Borradh.IO')).toBe(
      PROD_SESSION
    );
  });

  it('leaves a host-only cookie alone — the preview/local shape', () => {
    // COOKIE_DOMAIN is deliberately unset on previews, so cookies already
    // arrive with no Domain attribute and must pass through untouched.
    const hostOnly =
      'borradh_patient_session=abc123; Path=/; SameSite=Lax; Secure; HttpOnly';
    expect(rescopeCookieForHost(hostOnly, 'salon.com')).toBe(hostOnly);
  });

  it('handles a Domain with no leading dot', () => {
    const cookie = 'x=1; Path=/; Domain=borradh.io; Secure';
    expect(rescopeCookieForHost(cookie, 'app.borradh.io')).toBe(cookie);
    expect(rescopeCookieForHost(cookie, 'salon.com')).not.toMatch(/Domain=/i);
  });

  it('preserves an Expires containing a comma', () => {
    // Expires values contain a comma, which is why the proxy appends each
    // Set-Cookie as its own header line rather than folding them.
    const cookie =
      'x=1; Path=/; Domain=.borradh.io; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure';
    const result = rescopeCookieForHost(cookie, 'salon.com');
    expect(result).toContain('Expires=Wed, 21 Oct 2026 07:28:00 GMT');
    expect(result).not.toMatch(/Domain=/i);
  });
});
