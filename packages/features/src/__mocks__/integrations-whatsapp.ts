/**
 * Canonical mock for `@borradh-workspace/integrations/whatsapp`.
 *
 * Aliased in vite.config.ts so the real WhatsApp Cloud API code is never loaded
 * in tests, and so every test file sees the *same* mock — a prerequisite for
 * `isolate: false`. See docs/plans/features-test-isolation-windows.md.
 *
 * `WhatsAppCloudService` / `WhatsAppOAuthService` are `vi.fn()` constructors
 * that always return the SAME stable instance object (see
 * `_integration-service-mock`).
 *
 * Test files should NOT `vi.mock('@borradh-workspace/integrations/whatsapp')` —
 * import the symbol and drive it with `vi.mocked()`.
 * `beforeEach(vi.clearAllMocks())` resets call history between tests.
 */
import { createServiceMock } from './_integration-service-mock.js';

const whatsAppCloudService = createServiceMock();
const whatsAppOAuthService = createServiceMock();

/** Stable shared instance returned by every `new WhatsAppCloudService(...)`. */
export const mockWhatsAppCloudService = whatsAppCloudService.instance;
/** Stable shared instance returned by every `new WhatsAppOAuthService(...)`. */
export const mockWhatsAppOAuthService = whatsAppOAuthService.instance;

export const WhatsAppCloudService = whatsAppCloudService.ctor;
export const WhatsAppOAuthService = whatsAppOAuthService.ctor;
