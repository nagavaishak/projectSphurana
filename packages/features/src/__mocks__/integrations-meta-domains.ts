/**
 * Canonical mock for `@borradh-workspace/integrations/meta-domains`.
 *
 * Aliased in vite.config.ts so no test can reach graph.facebook.com, and so
 * every test file shares ONE mock instance (`isolate: false` — see the
 * MAINTENANCE RULE there).
 *
 * `MetaOwnedDomainError` and its classifier point at the REAL source: they are
 * pure string/shape logic with no network, and they are the only thing that
 * decides whether a failure emails a human or is silently retried. Mocking
 * them would delete the assertion that matters.
 */

import { vi } from 'vitest';
import { createServiceMock } from './_integration-service-mock.js';

const ownedDomains = createServiceMock();

/** Stable shared instance returned by every `new MetaOwnedDomainsService(...)`. */
export const mockMetaOwnedDomainsService = ownedDomains.instance;

export const MetaOwnedDomainsService = ownedDomains.ctor;

export const fetchAdAccountBusinessId = vi.fn(async () => 'biz_mock');

export {
  MetaOwnedDomainError,
  classifyOwnedDomainError,
  toOwnedDomainError,
} from '../../../integrations/src/meta-domains/meta-domains.errors.js';
