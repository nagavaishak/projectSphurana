/**
 * Canonical mock for `@borradh-workspace/integrations/encryption`.
 *
 * Aliased in vite.config.ts so every test file sees the *same* mock — a
 * prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/integrations/encryption')`
 * — import the symbol and drive it with `vi.mocked()`.
 * `beforeEach(vi.clearAllMocks())` resets call history between tests.
 */
import { vi } from 'vitest';

export const encryptCredentials = vi.fn();
export const decryptCredentials = vi.fn();
export const generateEncryptionKey = vi.fn();
