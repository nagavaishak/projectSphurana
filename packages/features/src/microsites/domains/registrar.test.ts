import { describe, expect, it, vi } from 'vitest';
import {
  detectRegistrar,
  registrarDnsUrl,
  registrarFromNameservers,
} from './registrar.js';

describe('registrarFromNameservers', () => {
  it('identifies the common registrars from their nameserver suffix', () => {
    for (const [ns, id] of [
      ['ns1.domaincontrol.com', 'godaddy'],
      ['kai.ns.cloudflare.com', 'cloudflare'],
      ['dns1.registrar-servers.com', 'namecheap'],
      ['ns1.blacknight.com', 'blacknight'],
      ['ns-cloud-a1.googledomains.com', 'squarespace'],
      ['ns1.vercel-dns.com', 'vercel'],
    ] as const) {
      expect(registrarFromNameservers([ns]).id, ns).toBe(id);
    }
  });

  it('lowercases and strips the root dot before matching', () => {
    expect(registrarFromNameservers(['NS1.DomainControl.Com.']).id).toBe(
      'godaddy'
    );
  });

  // The long tail is the NORMAL case — it must not look like a failure.
  it('reports an unknown registrar as a result, not an error', () => {
    const result = registrarFromNameservers(['ns1.some-tiny-host.example.org']);
    expect(result.id).toBe('unknown');
    expect(result.name).toBeNull();
    expect(result.dnsSettingsUrl).toBeNull();
    expect(result.nameservers).toEqual(['ns1.some-tiny-host.example.org']);
  });
});

describe('registrarDnsUrl', () => {
  it('interpolates the tenant domain into the deep link', () => {
    const registrar = registrarFromNameservers(['ns1.domaincontrol.com']);
    expect(registrarDnsUrl(registrar, 'salon.com')).toBe(
      'https://dcc.godaddy.com/control/dnsmanagement?domainName=salon.com'
    );
  });

  it('returns null when we have no reliable link', () => {
    expect(
      registrarDnsUrl(
        registrarFromNameservers(['ns1.unknown.example']),
        'x.com'
      )
    ).toBeNull();
  });
});

describe('detectRegistrar', () => {
  it('resolves NS for the domain and maps it', async () => {
    const resolver = vi.fn().mockResolvedValue(['ns1.domaincontrol.com']);
    const result = await detectRegistrar('salon.com', resolver);

    expect(resolver).toHaveBeenCalledWith('salon.com');
    expect(result.id).toBe('godaddy');
  });

  it('falls back to the apex when a subdomain has no delegation of its own', async () => {
    const resolver = vi
      .fn()
      .mockRejectedValueOnce(new Error('ENODATA'))
      .mockResolvedValueOnce(['dns1.registrar-servers.com']);

    const result = await detectRegistrar('book.salon.com', resolver);

    expect(resolver).toHaveBeenNthCalledWith(1, 'book.salon.com');
    expect(resolver).toHaveBeenNthCalledWith(2, 'salon.com');
    expect(result.id).toBe('namecheap');
  });

  // A DNS failure must never block domain setup — the provider verifies, not us.
  it('never throws: a total lookup failure yields the unknown shape', async () => {
    const resolver = vi.fn().mockRejectedValue(new Error('ESERVFAIL'));
    const result = await detectRegistrar('salon.com', resolver);

    expect(result).toEqual({
      id: 'unknown',
      name: null,
      dnsSettingsUrl: null,
      nameservers: [],
    });
  });
});
