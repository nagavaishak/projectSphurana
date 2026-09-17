import { PostHog } from 'posthog-node';
// Pins the posthog-node methods this workspace calls.
//
// Every one of these is invoked inside a try/catch that deliberately swallows —
// error reporting must never mask the error it is reporting. That makes a renamed
// or removed SDK method invisible: telemetry just stops, nothing fails, and we
// find out weeks later by diffing against another sink. That is precisely the
// bug class this observability work exists to close, so the SDK surface gets a
// contract test instead of trust.
//
// If this fails after a posthog-node bump, do NOT delete the assertion — find
// the replacement API and update the call sites (grep for the method name).
import { describe, expect, it } from 'vitest';

describe('posthog-node API contract', () => {
  const methods = [
    // packages/observability/src/posthog/client.ts
    'capture',
    'captureException',
    'identify',
    'groupIdentify',
    'isFeatureEnabled',
    'getFeatureFlag',
    // apps/marketing-astro/src/lib/server-observability.ts relies on shutdown()
    // to JOIN pending promises — it is the only call that guarantees delivery
    // before a serverless instance freezes. Do NOT assume captureException or
    // captureExceptionImmediate await delivery; neither does. See the long
    // comment on captureServerException.
    'shutdown',
    'flush',
  ] as const;

  for (const method of methods) {
    it(`exposes ${method}()`, () => {
      expect(typeof PostHog.prototype[method]).toBe('function');
    });
  }
});
