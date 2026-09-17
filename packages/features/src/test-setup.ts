/**
 * Vitest setup file for @borradh-workspace/features
 *
 * This file runs before all tests and sets up:
 * - Custom matchers
 * - Global test utilities
 * - Environment configuration
 * - Global mocks for observability
 */

import { sendEmail, sendHtmlEmail } from '@borradh-workspace/email';
import { setupCustomMatchers } from '@borradh-workspace/testing';
import { beforeEach, vi } from 'vitest';

// Register custom matchers
setupCustomMatchers();

// OAuth `state` is HMAC-signed from BETTER_AUTH_SECRET and signing is
// FAIL-CLOSED — with no adequate secret, signOAuthState() returns null and any
// flow that mints a state errors out. That is the correct production
// behaviour, but it means tests need a secret present or they exercise the
// refusal path instead of the code under test.
process.env.BETTER_AUTH_SECRET ??= 'test-better-auth-secret-at-least-32-chars';

// `@borradh-workspace/email` is a SHARED aliased singleton under `isolate: false`
// (aliased to src/__mocks__/email.ts). Some files mutate it persistently —
// `mockReset()` (leaves a bare fn) or `mockRejectedValue()` (leaves a rejecting
// fn) — and `vi.clearAllMocks()` clears calls but NOT implementations, so the
// residue bleeds into whichever file runs next in the shared graph. Callers
// commonly fire-and-forget with `sendEmail(...).catch(...)`, and a bare fn
// returns undefined so `.catch` throws. Re-establish a resolving default before
// EVERY test; this setup-file hook runs before each file's own `beforeEach`, so
// files that need a specific behaviour still override it.
beforeEach(() => {
  vi.mocked(sendEmail)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(sendHtmlEmail)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

// NOTE: observability is now mocked canonically via a vite.config.ts `alias`
// pointing at src/__mocks__/observability.ts (the real package is never loaded).
// That replaces the former global `vi.mock('@borradh-workspace/observability')`
// here — a prerequisite for `isolate: false`, since a hoisted setup-file mock
// can be silently overridden by per-file `vi.mock` and leak across the shared
// worker graph. Test files must NOT `vi.mock` observability; import the symbol
// and drive it with `vi.mocked()`. See docs/plans/features-test-suite-speedup.md.
