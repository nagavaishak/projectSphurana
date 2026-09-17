/**
 * Shared helper for canonical integration-service mocks.
 *
 * Service classes (`MetaAdsService`, `StripeService`, `WhatsAppCloudService`,
 * ...) are mocked as a `vi.fn()` constructor that ALWAYS returns the SAME
 * stable instance object. The instance is an auto-vivifying proxy: any method
 * access returns a stable `vi.fn()`, so a mock never has to enumerate the full
 * service surface, and there is no per-file `Service.mockImplementation(...)`
 * state to leak under `isolate: false`.
 *
 * `beforeEach(vi.clearAllMocks())` (already standard in the suite) clears the
 * call history of both the constructor and every auto-vivified method.
 */
import { vi } from 'vitest';

export interface ServiceMock {
  /** The `vi.fn()` constructor — assign to the class export. */
  ctor: ReturnType<typeof vi.fn>;
  /** The stable instance object the constructor returns. */
  instance: Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Build a `{ ctor, instance }` pair for one mocked service class.
 *
 * `extra` lets a caller seed specific properties on the instance up front
 * (rarely needed — auto-vivification covers methods).
 */
export const createServiceMock = (
  extra?: Record<string, unknown>
): ServiceMock => {
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const instance = new Proxy(
    { ...(extra ?? {}) } as Record<string, ReturnType<typeof vi.fn>>,
    {
      get(target, prop: string) {
        if (prop in target) {
          return (target as Record<string, unknown>)[prop];
        }
        let fn = methods.get(prop);
        if (!fn) {
          fn = vi.fn();
          methods.set(prop, fn);
        }
        return fn;
      },
      has() {
        return true;
      },
    }
  );

  const ctor = vi.fn(() => instance);
  return { ctor, instance };
};
