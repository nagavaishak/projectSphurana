/**
 * Registrar detection from NS records (plan §2.2).
 *
 * "Detect the registrar from NS records and deep-link the exact settings page.
 * That alone kills most of the support load; it is not a nicety."
 *
 * The support ticket this prevents is always the same one: a tenant is shown a
 * correct A record and a correct CNAME, and has no idea where on GoDaddy's site
 * to type them. A link straight to their own DNS page turns a 20-minute support
 * conversation into a click.
 *
 * TWO DESIGN RULES:
 *
 *   - An UNKNOWN registrar is a NORMAL RESULT, not an error. Most of the long
 *     tail of registrars will never be in this table, and a tenant on an
 *     unrecognised one must still get their records and a generic instruction.
 *     Returning an error here would block domain setup on a cosmetic lookup.
 *   - A DNS failure is also not an error for the same reason. NS records are
 *     advisory here; the provider's own verification is the source of truth.
 *
 * Detection is by NAMESERVER suffix, not by WHOIS. Nameservers say who is
 * serving DNS today — which is the page the tenant actually needs — whereas
 * WHOIS says who sold the domain, which is often a different company and always
 * a rate-limited, licence-encumbered lookup.
 */

import { createLogger } from '@borradh-workspace/observability';

const logger = createLogger('MicrositeRegistrar');

export interface RegistrarInfo {
  /** Stable id for the UI (icon, copy). `unknown` when nothing matched. */
  id: string;
  /** Display name, or `null` when unrecognised. */
  name: string | null;
  /**
   * Deep link to the DNS settings page, with the domain interpolated where the
   * registrar supports it. `null` when we have no reliable link.
   */
  dnsSettingsUrl: string | null;
  /** The nameservers we saw. Shown as a fallback hint when `id` is `unknown`. */
  nameservers: string[];
}

interface RegistrarRule {
  id: string;
  name: string;
  /** Lowercased nameserver suffixes. Matched with `endsWith`. */
  suffixes: string[];
  /** `{domain}` is replaced with the tenant's domain. */
  dnsSettingsUrl: string | null;
}

/**
 * Ordered by how often we expect to see them in this market (Ireland/UK first,
 * then the global volume registrars). Order only affects which rule wins when a
 * nameserver matches two suffixes, which should not happen.
 */
const REGISTRARS: RegistrarRule[] = [
  {
    id: 'godaddy',
    name: 'GoDaddy',
    suffixes: ['domaincontrol.com', 'godaddy.com'],
    dnsSettingsUrl:
      'https://dcc.godaddy.com/control/dnsmanagement?domainName={domain}',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    suffixes: ['ns.cloudflare.com'],
    dnsSettingsUrl: 'https://dash.cloudflare.com/?to=/:account/{domain}/dns',
  },
  {
    id: 'namecheap',
    name: 'Namecheap',
    suffixes: ['registrar-servers.com', 'namecheaphosting.com'],
    dnsSettingsUrl:
      'https://ap.www.namecheap.com/domains/domaincontrolpanel/{domain}/advancedns',
  },
  {
    id: 'blacknight',
    name: 'Blacknight',
    suffixes: ['blacknight.com', 'blacknightsolutions.com'],
    dnsSettingsUrl: 'https://cp.blacknight.com/',
  },
  {
    id: 'letshost',
    name: 'LetsHost',
    suffixes: ['letshost.ie'],
    dnsSettingsUrl: 'https://www.letshost.ie/clients/clientarea.php',
  },
  {
    id: 'register365',
    name: 'Register365',
    suffixes: ['register365.com', 'reg365.net'],
    dnsSettingsUrl: 'https://www.register365.com/login',
  },
  {
    id: '123reg',
    name: '123 Reg',
    suffixes: ['123-reg.co.uk'],
    dnsSettingsUrl:
      'https://www.123-reg.co.uk/secure/cpanel/domain/{domain}/dns',
  },
  {
    id: 'ionos',
    name: 'IONOS',
    suffixes: ['ui-dns.com', 'ui-dns.org', 'ui-dns.de', 'ui-dns.biz'],
    dnsSettingsUrl: 'https://my.ionos.com/domain-overview',
  },
  {
    id: 'squarespace',
    name: 'Squarespace Domains',
    suffixes: ['squarespacedns.com', 'googledomains.com'],
    dnsSettingsUrl: 'https://account.squarespace.com/domains',
  },
  {
    id: 'wix',
    name: 'Wix',
    suffixes: ['wixdns.net'],
    dnsSettingsUrl: 'https://www.wix.com/my-account/domains',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    suffixes: ['shopifydns.com'],
    dnsSettingsUrl: 'https://admin.shopify.com/settings/domains',
  },
  {
    id: 'hostinger',
    name: 'Hostinger',
    suffixes: ['dns-parking.com', 'hostinger.com'],
    dnsSettingsUrl: 'https://hpanel.hostinger.com/domains',
  },
  {
    id: 'gandi',
    name: 'Gandi',
    suffixes: ['gandi.net'],
    dnsSettingsUrl: 'https://admin.gandi.net/domain/{domain}/records',
  },
  {
    id: 'ovh',
    name: 'OVH',
    suffixes: ['ovh.net', 'ovh.ca'],
    dnsSettingsUrl: 'https://www.ovh.com/manager/#/web/domain/{domain}/zone',
  },
  {
    id: 'namesilo',
    name: 'NameSilo',
    suffixes: ['namesilo.com'],
    dnsSettingsUrl: 'https://www.namesilo.com/account_domains.php',
  },
  {
    id: 'porkbun',
    name: 'Porkbun',
    suffixes: ['porkbun.com'],
    dnsSettingsUrl: 'https://porkbun.com/account/domainsSpeedy',
  },
  {
    id: 'dynadot',
    name: 'Dynadot',
    suffixes: ['dynadot.com'],
    dnsSettingsUrl: 'https://www.dynadot.com/domain/manage.html',
  },
  {
    id: 'name-com',
    name: 'Name.com',
    suffixes: ['name.com'],
    dnsSettingsUrl: 'https://www.name.com/account/domain/details/{domain}#dns',
  },
  {
    id: 'one-com',
    name: 'one.com',
    suffixes: ['one.com'],
    dnsSettingsUrl: 'https://www.one.com/admin/dns-settings.do',
  },
  {
    id: 'network-solutions',
    name: 'Network Solutions',
    suffixes: ['worldnic.com'],
    dnsSettingsUrl: 'https://www.networksolutions.com/my-account/domains',
  },
  {
    id: 'enom',
    name: 'Enom',
    suffixes: ['name-services.com', 'enom.com'],
    dnsSettingsUrl: 'https://cp.enom.com/',
  },
  {
    id: 'route53',
    name: 'Amazon Route 53',
    suffixes: ['awsdns-00.com', 'awsdns'],
    dnsSettingsUrl: 'https://console.aws.amazon.com/route53/v2/hostedzones',
  },
  {
    id: 'azure-dns',
    name: 'Azure DNS',
    suffixes: ['azure-dns.com', 'azure-dns.net', 'azure-dns.org'],
    dnsSettingsUrl:
      'https://portal.azure.com/#browse/Microsoft.Network%2Fdnszones',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    suffixes: ['digitalocean.com'],
    dnsSettingsUrl: 'https://cloud.digitalocean.com/networking/domains',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    suffixes: ['vercel-dns.com'],
    dnsSettingsUrl: 'https://vercel.com/dashboard/domains',
  },
  {
    id: 'netlify',
    name: 'Netlify',
    suffixes: ['nsone.net', 'netlifydns.com'],
    dnsSettingsUrl: 'https://app.netlify.com/teams/domains',
  },
];

/** Lookup seam. Production passes `node:dns/promises#resolveNs`. */
export type NameserverResolver = (domain: string) => Promise<string[]>;

const defaultResolver: NameserverResolver = async (domain) => {
  const { resolveNs } = await import('node:dns/promises');
  return resolveNs(domain);
};

/** Match a set of nameservers against the table. Pure — no I/O. */
export const registrarFromNameservers = (
  nameservers: string[]
): RegistrarInfo => {
  const normalized = nameservers
    .map((ns) => ns.trim().toLowerCase().replace(/\.+$/, ''))
    .filter(Boolean);

  for (const rule of REGISTRARS) {
    const hit = normalized.some((ns) =>
      rule.suffixes.some(
        (suffix) =>
          ns === suffix || ns.endsWith(`.${suffix}`) || ns.includes(suffix)
      )
    );
    if (hit) {
      return {
        id: rule.id,
        name: rule.name,
        dnsSettingsUrl: rule.dnsSettingsUrl,
        nameservers: normalized,
      };
    }
  }

  // The normal case for the long tail. Not an error — see the file header.
  return {
    id: 'unknown',
    name: null,
    dnsSettingsUrl: null,
    nameservers: normalized,
  };
};

/**
 * Resolve the NS records for a domain's registrable apex and identify the
 * registrar. NEVER throws and NEVER returns an error: a lookup failure yields
 * the same `unknown` shape a missing table entry does, because both mean "show
 * the generic instructions".
 */
export const detectRegistrar = async (
  domain: string,
  resolver: NameserverResolver = defaultResolver
): Promise<RegistrarInfo> => {
  // Query the apex: a subdomain usually has no NS records of its own, and the
  // delegation that matters lives one or two labels up.
  const labels = domain.split('.');
  const candidates =
    labels.length > 2
      ? [domain, labels.slice(-3).join('.'), labels.slice(-2).join('.')]
      : [domain];

  for (const candidate of new Set(candidates)) {
    try {
      const nameservers = await resolver(candidate);
      if (nameservers.length > 0) return registrarFromNameservers(nameservers);
    } catch (error) {
      logger.debug('NS lookup failed', {
        domain: candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { id: 'unknown', name: null, dnsSettingsUrl: null, nameservers: [] };
};

/** Fill `{domain}` in a registrar deep link. */
export const registrarDnsUrl = (
  registrar: RegistrarInfo,
  domain: string
): string | null =>
  registrar.dnsSettingsUrl
    ? registrar.dnsSettingsUrl.replace('{domain}', encodeURIComponent(domain))
    : null;
