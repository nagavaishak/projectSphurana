/**
 * Shared HTML utilities for website fetching and text extraction.
 * Used by both the onboarding website-analysis service and the chatbot
 * website analysis service.
 */

import { lookup } from 'node:dns/promises';
import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';
import { SCRAPER_USER_AGENT } from './user-agent.js';

/**
 * BlockList of internal / non-routable address ranges. Any resolved IP that
 * falls inside one of these ranges is rejected to prevent SSRF.
 */
const internalRanges = new BlockList();

// IPv4 — loopback, RFC1918, link-local (incl. cloud metadata 169.254.169.254),
// CGNAT, "this host", broadcast.
internalRanges.addSubnet('0.0.0.0', 8, 'ipv4'); // "this host" / 0.0.0.0/8
internalRanges.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC1918
internalRanges.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT (RFC6598)
internalRanges.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
internalRanges.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + metadata
internalRanges.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC1918
internalRanges.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918
internalRanges.addAddress('255.255.255.255', 'ipv4'); // broadcast

// IPv6 — loopback, link-local, unique-local (fc00::/7).
internalRanges.addAddress('::1', 'ipv6'); // loopback
internalRanges.addAddress('::', 'ipv6'); // unspecified
internalRanges.addSubnet('fe80::', 10, 'ipv6'); // link-local
internalRanges.addSubnet('fc00::', 7, 'ipv6'); // unique-local (ULA)

/**
 * Strip an IPv4-mapped IPv6 prefix (e.g. ::ffff:127.0.0.1) so the embedded
 * IPv4 address is checked against the IPv4 ranges.
 */
function normalizeAddress(
  address: string
): { ip: string; version: 'ipv4' | 'ipv6' } | null {
  let ip = address;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];

  if (isIPv4(ip)) return { ip, version: 'ipv4' };
  if (isIPv6(ip)) return { ip, version: 'ipv6' };
  return null;
}

/**
 * Return true if the given IP literal points at an internal/non-routable
 * address that must never be fetched server-side.
 */
function isInternalIp(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return true; // fail closed on anything we can't parse
  return internalRanges.check(normalized.ip, normalized.version);
}

/**
 * A host is an acceptable literal only if it is a canonical dotted-quad IPv4
 * address or a (bracket-stripped) IPv6 address. Non-canonical IP encodings —
 * decimal (2130706433), hex (0x7f000001), octal (0177.0.0.1), or mixed forms —
 * are rejected outright because Node's socket layer would still parse them as
 * the underlying internal address, bypassing string-based range checks.
 */
function isCanonicalHostLiteral(host: string): boolean {
  if (isIP(host) !== 0) return true; // already a canonical v4/v6 literal

  // Anything that is purely numeric / hex / octal but NOT a valid dotted-quad
  // is a disguised IP literal — reject it.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false;

  // Reject dotted forms that contain hex/octal octets or the wrong octet count
  // (e.g. 0x7f.0.0.1, 0177.0.0.1, 127.1). These are entirely numeric/hex with
  // dots; a genuine hostname has at least one label containing a non-hex
  // letter, so it won't match here. We require a leading digit to avoid
  // misclassifying real hex-letter domains like "dead.beef".
  if (/^[0-9](?:[0-9a-fx]|\.)*$/i.test(host)) {
    const looksLikeDottedQuad = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (!looksLikeDottedQuad) return false;
  }

  return true; // treat as a hostname to be DNS-resolved
}

/**
 * Thrown by `assertExternalUrl` — and only by it — when a URL is refused on
 * SSRF grounds.
 *
 * Callers need to tell "this URL is not allowed to be fetched" apart from "this
 * fetch failed", because the two get opposite treatment: a blocked fetch may
 * fall back to another scraping strategy, an SSRF rejection must always be
 * terminal and alertable. Matching on the message text would be brittle, and
 * the redirect hops inside `fetchWebsiteContent` re-run the check, so the
 * distinction has to survive being caught several frames up.
 */
export class BlockedUrlError extends Error {
  override readonly name = 'BlockedUrlError';
}

/**
 * Validate that a URL does not point to internal/private network addresses.
 * Prevents SSRF attacks by blocking requests to localhost, private IPs,
 * cloud metadata endpoints, and link-local addresses.
 *
 * This resolves the host via DNS and validates EVERY resolved IP, so domains
 * whose DNS points at internal/metadata addresses are also rejected. The set of
 * resolved IPs is returned so callers can pin the connection to a validated
 * address (mitigating DNS-rebinding).
 */
export async function assertExternalUrl(urlString: string): Promise<string[]> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new BlockedUrlError('Invalid URL');
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BlockedUrlError('Only HTTP(S) URLs are allowed');
  }

  let host = parsed.hostname.toLowerCase();

  if (host === 'localhost') {
    throw new BlockedUrlError('Requests to loopback addresses are not allowed');
  }

  // Strip IPv6 brackets for literal checks.
  const isBracketed = host.startsWith('[') && host.endsWith(']');
  if (isBracketed) host = host.slice(1, -1);

  // Reject non-canonical IP literal encodings (decimal/hex/octal).
  if (!isBracketed && !isCanonicalHostLiteral(host)) {
    throw new BlockedUrlError('Non-canonical IP literal hosts are not allowed');
  }

  // If the host is already an IP literal, validate it directly — no DNS needed.
  if (isIP(host) !== 0) {
    if (isInternalIp(host)) {
      throw new BlockedUrlError(
        'Requests to private network addresses are not allowed'
      );
    }
    return [host];
  }

  // Otherwise resolve via DNS and validate EVERY resolved address.
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError('Could not resolve host');
  }

  if (resolved.length === 0) {
    throw new BlockedUrlError('Could not resolve host');
  }

  for (const { address } of resolved) {
    if (isInternalIp(address)) {
      throw new BlockedUrlError(
        'Requests to private network addresses are not allowed'
      );
    }
  }

  return resolved.map((r) => r.address);
}

/**
 * Fetch HTML content from a URL with timeout and error handling.
 * Follows redirects manually to preserve cookies.
 */
export async function fetchWebsiteContent(url: string): Promise<string> {
  // Validates the host (DNS-resolves and checks every IP). We re-validate
  // immediately before each connect (initial + every redirect) to minimise the
  // window for DNS rebinding. Residual risk: native fetch performs its own DNS
  // lookup at connect time, so a TOCTOU rebinding race remains — pinning the
  // connection to a validated IP would require a custom undici dispatcher,
  // which is deferred (see PRD-8 report).
  await assertExternalUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const maxRedirects = 5;

  try {
    let currentUrl = url;
    const cookies = new Map<string, string>();

    for (let i = 0; i <= maxRedirects; i++) {
      const cookieHeader = [...cookies.values()].join('; ');
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': SCRAPER_USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });

      // Collect Set-Cookie headers
      const setCookies = response.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const [nameValue] = sc.split(';');
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx > 0) {
          const name = nameValue.slice(0, eqIdx).trim();
          cookies.set(name, nameValue.trim());
        }
      }

      // Follow redirects manually to preserve cookies
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(
            `Redirect ${response.status} without Location header`
          );
        }
        currentUrl = new URL(location, currentUrl).href;
        await assertExternalUrl(currentUrl);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    }

    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract metadata (title, description, OG tags, JSON-LD) from HTML.
 */
export function extractMetadataFromHtml(html: string): string {
  const parts: string[] = [];

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) parts.push(`Title: ${titleMatch[1].trim()}`);

  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
  );
  if (descMatch?.[1]) parts.push(`Description: ${descMatch[1].trim()}`);

  const ogPatterns = [
    { name: 'og:title', label: 'OG Title' },
    { name: 'og:description', label: 'OG Description' },
    { name: 'og:site_name', label: 'Site Name' },
  ];
  for (const { name, label } of ogPatterns) {
    const match = html.match(
      new RegExp(
        `<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']+)["']`,
        'i'
      )
    );
    if (match?.[1]) parts.push(`${label}: ${match[1].trim()}`);
  }

  const jsonLdMatches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (jsonLdMatches) {
    for (const block of jsonLdMatches.slice(0, 3)) {
      const content = block.replace(/<\/?script[^>]*>/gi, '').trim();
      try {
        const parsed = JSON.parse(content);
        const jsonStr = JSON.stringify(parsed);
        if (jsonStr.length < 3000) {
          parts.push(`Structured data: ${jsonStr}`);
        }
      } catch {
        // Skip malformed JSON-LD
      }
    }
  }

  return parts.join('\n');
}

/**
 * Extract text content from HTML, stripping tags and scripts.
 * Limited to first 15000 characters to stay within token limits.
 */
export function extractTextFromHtml(html: string): string {
  // Remove script and style tags with their content
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // If body text is sparse, prepend metadata
  if (text.length < 200) {
    const metadata = extractMetadataFromHtml(html);
    if (metadata) {
      text = `${metadata}\n\n${text}`;
    }
  }

  return text.slice(0, 15000);
}
