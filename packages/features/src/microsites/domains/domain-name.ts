/**
 * Normalising and validating a tenant-supplied hostname.
 *
 * This is a SECURITY boundary, not a tidiness pass. `microsite_domain.domain`
 * carries a global UNIQUE constraint and host resolution reads it on every
 * public request, so whatever lands in that column decides which tenant a
 * hostname serves. Three rejections are load-bearing:
 *
 *   1. OUR OWN APEXES. A tenant who could register `borradh.io` or
 *      `acme.borradh.io` as a "custom" domain would take a row that the CUSTOM
 *      tier consults BEFORE the wildcard tier — hijacking `*.borradh.io` for
 *      every org whose slug they guessed. `resolveMicrositeHost` already refuses
 *      to consult the custom tier for our own hosts; this is the other half of
 *      that defence, and neither half is sufficient alone.
 *   2. IP LITERALS. An IP in a hostname column resolves nothing, and an
 *      IP-shaped "domain" handed to the provider is a request to route traffic
 *      by address.
 *   3. NON-PUBLIC NAMES (`.local`, `.internal`, `.test`, …). They cannot be
 *      verified, cannot get a certificate, and only ever produce a domain stuck
 *      in `pending_dns` for seven days.
 *
 * Normalisation is IDNA-aware: `caffè.ie` and `xn--caff-8na.ie` are the same
 * host and must not become two rows competing for the unique constraint.
 * `new URL()` performs ToASCII for us, which is the same algorithm the
 * resolver, the provider and the browser use — hand-rolling it is how the two
 * spellings drift apart.
 */

/**
 * The apexes we own. Comma-separated, env-driven, so staging
 * (`borradh-dev.com`) is a config change rather than a deploy.
 *
 * Parsed here rather than imported from `resolveMicrositeHost` on purpose: this
 * module is the WRITE side of the same rule and must not stop enforcing it if
 * the read side is ever refactored. The two are checked against each other by
 * test, not by a shared import.
 */
export const micrositeBaseDomains = (): string[] =>
  (process.env.MICROSITE_BASE_DOMAIN ?? 'borradh.io')
    .split(',')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^\.+|\.+$/g, '')
    )
    .filter(Boolean);

/** Suffixes that can never be verified or certificated. */
const NON_PUBLIC_SUFFIXES = [
  'local',
  'localhost',
  'internal',
  'intranet',
  'test',
  'invalid',
  'example',
  'onion',
  'home.arpa',
];

/**
 * Two-part public suffixes we see in the markets we sell into. Used ONLY to
 * decide whether a name is registrable-apex-like (and therefore wants a `www`
 * sibling) — never for validation. A miss here costs a missing `www` alias, not
 * a wrong tenant, which is why a heuristic is acceptable where a full Public
 * Suffix List dependency is not.
 */
const MULTIPART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'net.uk',
  'sch.uk',
  'ac.uk',
  'gov.uk',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.au',
  'net.au',
  'org.au',
  'com.br',
  'com.mx',
  'co.za',
  'co.in',
  'co.jp',
  'or.jp',
  'ne.jp',
  'com.sg',
  'co.il',
]);

export type DomainRejectionReason =
  | 'empty'
  | 'malformed'
  | 'ip_address'
  | 'single_label'
  | 'too_long'
  | 'reserved_suffix'
  | 'own_apex';

export interface NormalizedDomain {
  /** Punycode/ASCII, lowercase, no scheme, no port, no trailing dot. */
  domain: string;
  /**
   * True when the name looks like a registrable apex (`salon.com`,
   * `salon.co.uk`) rather than a subdomain (`book.salon.com`). Decides whether
   * a `www` sibling is provisioned alongside it.
   */
  isApex: boolean;
  /** `www.salon.com` for an apex; `null` for a subdomain. */
  wwwAlias: string | null;
}

export type DomainValidation =
  | { valid: true; value: NormalizedDomain }
  | { valid: false; reason: DomainRejectionReason; message: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const ASCII_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Strip scheme, credentials, path, query and port; lowercase; drop root dot. */
const stripToHost = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');

/**
 * The one entry point. Everything that writes `microsite_domain.domain` — the
 * add service, the removal lookup, any future import script — goes through
 * here, so a hostname has exactly one spelling in the database.
 */
export const validateMicrositeDomain = (raw: string): DomainValidation => {
  const stripped = stripToHost(raw ?? '');
  if (!stripped) {
    return { valid: false, reason: 'empty', message: 'Enter a domain' };
  }

  // IPv6 arrives bracketed; reject before `new URL` normalises it into a
  // perfectly valid-looking hostname.
  if (stripped.startsWith('[') || stripped.includes(':')) {
    return {
      valid: false,
      reason: 'ip_address',
      message: 'Enter a domain name, not an IP address',
    };
  }

  // IDNA ToASCII via the URL parser — the same algorithm the resolver and the
  // provider use. Also rejects a pile of malformed input for free.
  let host: string;
  try {
    host = new URL(`https://${stripped}`).hostname;
  } catch {
    return {
      valid: false,
      reason: 'malformed',
      message: 'That does not look like a valid domain',
    };
  }
  host = host.replace(/\.+$/, '').toLowerCase();

  if (IPV4.test(host)) {
    return {
      valid: false,
      reason: 'ip_address',
      message: 'Enter a domain name, not an IP address',
    };
  }

  if (host.length > 253) {
    return {
      valid: false,
      reason: 'too_long',
      message: 'That domain is too long',
    };
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    return {
      valid: false,
      reason: 'single_label',
      message: 'Enter a full domain, for example salon.com',
    };
  }

  for (const label of labels) {
    if (!label || label.length > 63 || !ASCII_LABEL.test(label)) {
      return {
        valid: false,
        reason: 'malformed',
        message: 'That does not look like a valid domain',
      };
    }
  }

  const tld = labels[labels.length - 1] as string;
  const lastTwo = labels.slice(-2).join('.');
  if (
    NON_PUBLIC_SUFFIXES.includes(tld) ||
    NON_PUBLIC_SUFFIXES.includes(lastTwo) ||
    /^\d+$/.test(tld)
  ) {
    return {
      valid: false,
      reason: 'reserved_suffix',
      message: 'That domain cannot be used on the public internet',
    };
  }

  // ── Our own apexes ───────────────────────────────────────────────
  for (const apex of micrositeBaseDomains()) {
    if (host === apex || host.endsWith(`.${apex}`)) {
      return {
        valid: false,
        reason: 'own_apex',
        message:
          'That domain belongs to us — your free address is already set up for you',
      };
    }
  }

  const isApex =
    labels.length === 2 ||
    (labels.length === 3 && MULTIPART_SUFFIXES.has(lastTwo));

  return {
    valid: true,
    value: {
      domain: host,
      isApex,
      wwwAlias: isApex ? `www.${host}` : null,
    },
  };
};

/**
 * The names to provision for one tenant request: the canonical host and, for an
 * apex, its `www` sibling. Provisioning the pair is plan §2.1 — one redirects to
 * the other, and a tenant who types either one must land on the site.
 *
 * A user who typed `www.salon.com` is canonicalised to `salon.com`, so the pair
 * is the same set either way and the unique constraint sees one canonical row.
 */
export const domainPairFor = (
  value: NormalizedDomain
): { canonical: string; alias: string | null } => {
  if (value.domain.startsWith('www.')) {
    const apex = value.domain.slice(4);
    return { canonical: apex, alias: value.domain };
  }
  return { canonical: value.domain, alias: value.wwwAlias };
};
