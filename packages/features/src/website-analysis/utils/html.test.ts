import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `node:dns/promises` is mocked via the canonical alias in vite.config.ts — its
// `lookup` is a shared vi.fn. This file resets it in beforeEach and drives it
// per-test. Do NOT add a file-local `vi.mock('node:dns/promises')`: under
// `isolate: false` two factories collide on the shared worker graph and bind
// html.ts to a different `lookup` than the one driven here (the original flake).
import { lookup } from 'node:dns/promises';
import { assertExternalUrl } from './html.js';

const mockLookup = vi.mocked(lookup);

function resolvesTo(...addresses: string[]): void {
  mockLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    })) as never
  );
}

describe('assertExternalUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  // The WHATWG URL parser canonicalizes decimal/hex/octal/short IPv4 encodings
  // to dotted-quad form (e.g. 2130706433 -> 127.0.0.1) before we inspect the
  // hostname, so these are caught by the resolved-IP range check rather than the
  // literal-format guard. Either way, the security-relevant outcome is that the
  // request to the underlying internal address is rejected without any DNS
  // lookup. (The literal-format guard remains as defence-in-depth for any
  // non-WHATWG parse path.)
  describe('non-canonical IP literal encodings are rejected', () => {
    it('rejects decimal-encoded loopback (2130706433 = 127.0.0.1)', async () => {
      await expect(assertExternalUrl('http://2130706433/')).rejects.toThrow(
        /private network|non-canonical/i
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects hex-encoded loopback (0x7f000001 = 127.0.0.1)', async () => {
      await expect(assertExternalUrl('http://0x7f000001/')).rejects.toThrow(
        /private network|non-canonical/i
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects octal-encoded loopback (0177.0.0.1 = 127.0.0.1)', async () => {
      await expect(assertExternalUrl('http://0177.0.0.1/')).rejects.toThrow(
        /private network|non-canonical/i
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects short-form loopback (127.1 = 127.0.0.1)', async () => {
      await expect(assertExternalUrl('http://127.1/')).rejects.toThrow(
        /private network|non-canonical/i
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe('canonical private IP literals (no DNS)', () => {
    it('rejects dotted-quad loopback 127.0.0.1', async () => {
      await expect(assertExternalUrl('http://127.0.0.1/')).rejects.toThrow(
        /private network/i
      );
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects the cloud metadata IP 169.254.169.254', async () => {
      await expect(
        assertExternalUrl('http://169.254.169.254/latest/meta-data/')
      ).rejects.toThrow(/private network/i);
    });

    it('rejects RFC1918 10.0.0.5', async () => {
      await expect(assertExternalUrl('http://10.0.0.5/')).rejects.toThrow(
        /private network/i
      );
    });

    it('rejects CGNAT 100.64.1.1', async () => {
      await expect(assertExternalUrl('http://100.64.1.1/')).rejects.toThrow(
        /private network/i
      );
    });

    it('rejects IPv6 loopback [::1]', async () => {
      await expect(assertExternalUrl('http://[::1]/')).rejects.toThrow(
        /private network/i
      );
    });

    it('rejects localhost', async () => {
      await expect(assertExternalUrl('http://localhost/')).rejects.toThrow(
        /loopback/i
      );
    });
  });

  describe('DNS-resolved hosts', () => {
    it('rejects a hostname that resolves to a private IP', async () => {
      resolvesTo('192.168.1.10');
      await expect(
        assertExternalUrl('http://internal.example.com/')
      ).rejects.toThrow(/private network/i);
      expect(mockLookup).toHaveBeenCalledWith(
        'internal.example.com',
        expect.objectContaining({ all: true })
      );
    });

    it('rejects a hostname that resolves to the metadata IP', async () => {
      resolvesTo('169.254.169.254');
      await expect(
        assertExternalUrl('http://metadata.attacker.com/')
      ).rejects.toThrow(/private network/i);
    });

    it('rejects when ANY resolved IP is internal (mixed result)', async () => {
      resolvesTo('93.184.216.34', '10.1.2.3');
      await expect(
        assertExternalUrl('http://rebind.attacker.com/')
      ).rejects.toThrow(/private network/i);
    });

    it('rejects an IPv4-mapped IPv6 internal address', async () => {
      resolvesTo('::ffff:127.0.0.1');
      await expect(
        assertExternalUrl('http://mapped.attacker.com/')
      ).rejects.toThrow(/private network/i);
    });

    it('allows a hostname that resolves to a public IP', async () => {
      resolvesTo('93.184.216.34');
      await expect(
        assertExternalUrl('https://example.com/page')
      ).resolves.toEqual(['93.184.216.34']);
    });

    it('rejects when the host cannot be resolved', async () => {
      mockLookup.mockResolvedValue([] as never);
      await expect(
        assertExternalUrl('http://nxdomain.example/')
      ).rejects.toThrow(/resolve/i);
    });
  });

  describe('protocol + parsing guards', () => {
    it('rejects non-http(s) protocols', async () => {
      await expect(assertExternalUrl('file:///etc/passwd')).rejects.toThrow(
        /HTTP/i
      );
    });

    it('rejects malformed URLs', async () => {
      await expect(assertExternalUrl('not a url')).rejects.toThrow(
        /invalid url/i
      );
    });
  });
});
