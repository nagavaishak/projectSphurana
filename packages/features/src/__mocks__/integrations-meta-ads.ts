/**
 * Canonical mock for `@borradh-workspace/integrations/meta-ads`.
 *
 * Aliased in vite.config.ts so the real Meta Ads / facebook-nodejs-business-sdk
 * code is never loaded in tests, and so every test file sees the *same* mock —
 * a prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * `MetaAdsService` / `MetaOAuthService` are `vi.fn()` constructors that always
 * return the SAME stable instance object, whose methods are auto-vivified
 * `vi.fn()`s. There is no per-file `Service.mockImplementation(...)` state to
 * leak under a shared module registry.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/integrations/meta-ads')` —
 * import the symbol and drive it with `vi.mocked()`.
 * `beforeEach(vi.clearAllMocks())` resets call history between tests.
 */
import { createServiceMock } from './_integration-service-mock.js';

const metaAdsService = createServiceMock();
const metaOAuthService = createServiceMock();

/** Stable shared instance returned by every `new MetaAdsService(...)`. */
export const mockMetaAdsService = metaAdsService.instance;
/** Stable shared instance returned by every `new MetaOAuthService(...)`. */
export const mockMetaOAuthService = metaOAuthService.instance;

export const MetaAdsService = metaAdsService.ctor;
export const MetaOAuthService = metaOAuthService.ctor;

// MetaAppSecretMismatchError must be a real class so `instanceof` works.
import type { MetaApiError as _MetaApiErrorForMismatch } from '../../../integrations/src/shared/meta-api-error.js';
export class MetaAppSecretMismatchError extends Error {
  readonly metaError: _MetaApiErrorForMismatch;
  constructor(metaError: _MetaApiErrorForMismatch) {
    super(metaError.message);
    this.name = 'MetaAppSecretMismatchError';
    this.metaError = metaError;
  }
}
