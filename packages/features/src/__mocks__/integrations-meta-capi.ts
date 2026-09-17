/**
 * Canonical mock for `@borradh-workspace/integrations/meta-capi`.
 *
 * Aliased in vite.config.ts so no test can reach graph.facebook.com, and so
 * every test file shares ONE mock instance — the prerequisite for
 * `isolate: false` (see the MAINTENANCE RULE in vite.config.ts).
 *
 * The HASHING helpers point at the REAL source: they are pure `node:crypto`
 * with no network, and they are the control that stops mis-normalised customer
 * data from silently matching nobody. Mocking them would delete the only thing
 * worth asserting about a CAPI payload.
 *
 * Test files should NOT `vi.mock(...)` this path — import the symbol and drive
 * it with `vi.mocked()`.
 */

import { createServiceMock } from './_integration-service-mock.js';

const capiService = createServiceMock();
const pixelsService = createServiceMock();

/** Stable shared instance returned by every `new MetaCapiService(...)`. */
export const mockMetaCapiService = capiService.instance;
/** Stable shared instance returned by every `new MetaPixelsService(...)`. */
export const mockMetaPixelsService = pixelsService.instance;

export const MetaCapiService = capiService.ctor;
export const MetaPixelsService = pixelsService.ctor;

export {
  hashUserData,
  hasMatchKey,
  normalizeCountry,
  normalizeDateOfBirth,
  normalizeEmail,
  normalizeGender,
  normalizeName,
  normalizePhone,
  normalizeZip,
} from '../../../integrations/src/meta-capi/hash-user-data.js';

export const CAPI_MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;
export const isWithinCapiWindow = (
  eventTimeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean => nowSeconds - eventTimeSeconds <= CAPI_MAX_EVENT_AGE_SECONDS;
