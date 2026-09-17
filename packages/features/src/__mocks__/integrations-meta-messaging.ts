/**
 * Canonical mock for `@borradh-workspace/integrations/meta-messaging`.
 *
 * Aliased in vite.config.ts so the real Meta Messaging code is never loaded in
 * tests, and so every test file sees the *same* mock — a prerequisite for
 * `isolate: false`. See docs/plans/features-test-isolation-windows.md.
 *
 * `MetaMessagingService` is a `vi.fn()` constructor that always returns the
 * SAME stable instance object (see `_integration-service-mock`).
 *
 * Test files should NOT
 * `vi.mock('@borradh-workspace/integrations/meta-messaging')` — import the
 * symbol and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())`
 * resets call history between tests.
 */
import { createServiceMock } from './_integration-service-mock.js';

const metaMessagingService = createServiceMock();

/** Stable shared instance returned by every `new MetaMessagingService(...)`. */
export const mockMetaMessagingService = metaMessagingService.instance;

export const MetaMessagingService = metaMessagingService.ctor;
