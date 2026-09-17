import { describe, expect, it } from 'vitest';

import { micrositeLink, resolveMicrositeOrg } from './microsite-org';

const at = (hostname: string, pathname: string) => ({ hostname, pathname });

describe('resolveMicrositeOrg', () => {
  it('resolves the path tier — the only tier shipped today', () => {
    expect(
      resolveMicrositeOrg(at('www.borradh.io', '/sites/glow/portal'))
    ).toEqual({
      slug: 'glow',
      tier: 'path',
      basePath: '/sites/glow',
    });
  });

  it('resolves the wildcard tier with an empty basePath', () => {
    expect(resolveMicrositeOrg(at('glow.borradh.io', '/portal'))).toEqual({
      slug: 'glow',
      tier: 'wildcard',
      basePath: '',
    });
  });

  it('does NOT treat a nested subdomain as a tenant', () => {
    // Otherwise anyone able to create `evil.glow.borradh.io` claims the `evil`
    // slug. One label in front of the platform host, or nothing.
    expect(
      resolveMicrositeOrg(at('evil.glow.borradh.io', '/portal'))
    ).toBeNull();
  });

  it('returns null on a custom domain — the slug is not derivable from the host', () => {
    // The server resolves custom hosts. Guessing `salonname` from the hostname
    // would be a silent mis-scoping of an authenticated portal call.
    expect(resolveMicrositeOrg(at('salonname.com', '/portal'))).toBeNull();
  });

  it('prefers the path tier even on a platform host', () => {
    expect(resolveMicrositeOrg(at('www.borradh.io', '/sites/a/x'))?.slug).toBe(
      'a'
    );
  });

  it('ignores www and case', () => {
    expect(resolveMicrositeOrg(at('WWW.Borradh.IO', '/sites/Glow'))?.slug).toBe(
      'Glow'
    );
    expect(resolveMicrositeOrg(at('Glow.Borradh.IO', '/portal'))?.tier).toBe(
      'wildcard'
    );
  });

  it('returns null for the bare platform host', () => {
    expect(resolveMicrositeOrg(at('borradh.io', '/pricing'))).toBeNull();
  });
});

describe('micrositeLink', () => {
  it('prefixes on the path tier', () => {
    expect(micrositeLink({ basePath: '/sites/glow' }, '/book')).toBe(
      '/sites/glow/book'
    );
  });

  it('is a no-op on host tiers', () => {
    expect(micrositeLink({ basePath: '' }, '/book')).toBe('/book');
  });

  it('tolerates a missing leading slash', () => {
    expect(micrositeLink({ basePath: '/sites/glow' }, 'book')).toBe(
      '/sites/glow/book'
    );
  });
});
