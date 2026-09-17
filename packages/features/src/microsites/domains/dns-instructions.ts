/**
 * The DNS instructions a tenant is shown (plan §2.2).
 *
 * The RECORDS come from the provider, never from a constant in this package.
 * That is the whole point of the port: `76.76.21.21` and `cname.vercel-dns.com`
 * are facts about today's provider, and the day we move to Cloudflare for SaaS
 * this file must keep working without an edit. If you find yourself about to
 * hardcode an IP here, put it in the adapter instead.
 *
 * The REGISTRAR half is ours: which settings page to send them to is derived
 * from their NS records and has nothing to do with who terminates the TLS.
 */

import type { DomainDnsRecord } from '@borradh-workspace/integrations/domains';
import type { RegistrarInfo } from './registrar.js';
import { registrarDnsUrl } from './registrar.js';

export interface DomainInstructions {
  /** The canonical hostname the site will be served on. */
  domain: string;
  /** `www.<domain>` when one was provisioned, else `null`. */
  alias: string | null;
  /** Everything the tenant has to create, routing records first. */
  records: DomainDnsRecord[];
  registrar: {
    id: string;
    name: string | null;
    /** Deep link to THEIR DNS page, domain already interpolated. */
    dnsSettingsUrl: string | null;
    nameservers: string[];
  };
  /** Short, human notes rendered under the table. */
  notes: string[];
}

export const buildDomainInstructions = (input: {
  domain: string;
  alias: string | null;
  records: DomainDnsRecord[];
  registrar: RegistrarInfo;
}): DomainInstructions => {
  const notes = [
    'DNS changes usually apply within a few minutes, but can take up to 48 hours.',
    'We check automatically and switch your site over as soon as the records are live — you do not need to come back.',
  ];

  if (input.registrar.id === 'unknown') {
    // An unrecognised registrar is expected, not broken. Say what to look for
    // rather than apologising for not knowing who they are.
    notes.push(
      'Look for "DNS", "Nameservers" or "Advanced DNS" in your domain provider\'s control panel.'
    );
  }

  // Routing records first: they are the ones that actually put the site live,
  // and a tenant who stops halfway should have added the important one.
  const records = [...input.records].sort((a, b) =>
    a.purpose === b.purpose ? 0 : a.purpose === 'routing' ? -1 : 1
  );

  return {
    domain: input.domain,
    alias: input.alias,
    records,
    registrar: {
      id: input.registrar.id,
      name: input.registrar.name,
      dnsSettingsUrl: registrarDnsUrl(input.registrar, input.domain),
      nameservers: input.registrar.nameservers,
    },
    notes,
  };
};
