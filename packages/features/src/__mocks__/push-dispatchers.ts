/**
 * Canonical mock for the three push dispatchers
 * (`dispatch-expo.ts` / `dispatch-fcm.ts` / `dispatch-apns.ts`).
 *
 * These are thin SDK wrappers (Expo / Firebase Admin / APNs) that NO test wants
 * to exercise for real. They are aliased (by absolute path) in vite.config.ts so
 * the real modules — and their SDK side effects (`new Expo()`, dynamic
 * `firebase-admin` import, HTTP/2 APNs connection) — are never loaded. This is a
 * prerequisite for `isolate: false`: the real `send-push-notification.service`
 * is loaded into the shared worker graph by other services' tests (it is called
 * from create-notification, notify-agents, run-health-alerts, …), so a per-file
 * `vi.mock('./dispatch-expo.js')` would arrive too late to intercept it.
 *
 * Test files should NOT `vi.mock` the dispatchers — import the symbol and drive
 * it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())` resets between tests.
 */
import { vi } from 'vitest';

const emptyResult = { sent: 0, failed: 0, invalidTokens: [] as string[] };

export const dispatchExpo = vi.fn().mockResolvedValue(emptyResult);
export const dispatchFcm = vi.fn().mockResolvedValue(emptyResult);
export const dispatchApns = vi.fn().mockResolvedValue(emptyResult);
