/**
 * A `DomainProvider` test double. Test-only — not exported from the barrel.
 *
 * Its existence is the point of the port: every service test drives
 * provisioning without a network call, and a Cloudflare adapter would be
 * exercised by the same tests.
 */

import type {
  AddedDomain,
  DomainProvider,
  DomainProviderResult,
  DomainStatus,
  RemovedDomain,
} from '@borradh-workspace/integrations/domains';
import { vi } from 'vitest';

export const okAdd = (
  domain: string,
  alreadyExisted = false
): DomainProviderResult<AddedDomain> => ({
  success: true,
  data: {
    domain,
    alreadyExisted,
    records: [
      { type: 'A', name: '@', value: '203.0.113.1', purpose: 'routing' },
      {
        type: 'TXT',
        name: `_challenge.${domain}`,
        value: 'proof',
        purpose: 'challenge',
      },
    ],
    providerRef: `ref-${domain}`,
    state: 'pending_dns',
  },
});

export const okVerify = (
  domain: string,
  state: DomainStatus['state'] = 'active'
): DomainProviderResult<DomainStatus> => ({
  success: true,
  data: { domain, state, records: [], providerRef: `ref-${domain}` },
});

export const okRemove = (
  domain: string,
  alreadyRemoved = false
): DomainProviderResult<RemovedDomain> => ({
  success: true,
  data: { domain, alreadyRemoved },
});

export const providerFailure = (
  code: string,
  message = 'nope'
): DomainProviderResult<never> => ({
  success: false,
  error: { code, message },
});

export const createFakeProvider = () => {
  const add = vi.fn(async (domain: string) => okAdd(domain));
  const verify = vi.fn(async (domain: string) => okVerify(domain));
  const remove = vi.fn(async (domain: string) => okRemove(domain));
  return { add, verify, remove } as unknown as DomainProvider & {
    add: typeof add;
    verify: typeof verify;
    remove: typeof remove;
  };
};

export type FakeProvider = ReturnType<typeof createFakeProvider>;
