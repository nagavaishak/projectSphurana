import { apiEnv } from '@borradh-workspace/env/api';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// See dispatch-fcm.test.ts for why the import dodges the `^\./dispatch-…` alias.
import {
  __resetFcmStateForTests,
  dispatchFcm,
} from '../send-push-notification/dispatch-fcm.js';

/**
 * Real FCM HTTP v1 integration test — hits Google, no mocking.
 *
 * WHY THIS EXISTS
 * ---------------
 * `dispatch-fcm.test.ts` pins request shape and error mapping against a fake
 * transport. It cannot prove the things that actually break when you move off
 * firebase-admin: that Google accepts our JWT's `aud` and `scope`, that the
 * assertion is signed the way the token endpoint expects, that the v1 URL and
 * project path are right, or that our message field names are the ones FCM
 * wants. Only a real call proves those.
 *
 * Preview cannot cover it either: `.github/preview.env` sets FCM_DRY_RUN=true
 * and ships NO service account, so every push there short-circuits on the
 * `configError` branch long before reaching this code.
 *
 * SAFETY
 * ------
 * Every send here sets `validate_only` (FCM_DRY_RUN=true). FCM verifies
 * credentials, payload and token, then delivers NOTHING. It is the closest
 * thing FCM has to APNs' sandbox, and it is why this test can run against the
 * production service account without paging a single real device.
 *
 * RUNNING IT
 *
 *   FCM_SERVICE_ACCOUNT_BASE64="$(cd infra && pulumi config get fcmServiceAccountBase64 --stack prod)" \
 *     pnpm --filter @borradh-workspace/features exec vitest run \
 *       src/notifications/services/send-push-notification/dispatch-fcm.integration.test.ts
 *
 * Optionally set FCM_TEST_DEVICE_TOKEN to a real registration token to also
 * prove every payload field is accepted (see the second describe block).
 */
const serviceAccountBase64 = process.env.FCM_SERVICE_ACCOUNT_BASE64;
const realDeviceToken = process.env.FCM_TEST_DEVICE_TOKEN;

const TIMEOUT = 30_000;

const originalServiceAccount = apiEnv.FCM_SERVICE_ACCOUNT_BASE64;
const originalDryRun = apiEnv.FCM_DRY_RUN;

afterAll(() => {
  apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = originalServiceAccount;
  apiEnv.FCM_DRY_RUN = originalDryRun;
  __resetFcmStateForTests();
});

describe.runIf(serviceAccountBase64)('dispatchFcm (real FCM v1)', () => {
  beforeEach(() => {
    __resetFcmStateForTests();
    apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = serviceAccountBase64;
    // Never deliver. FCM validates everything and drops the message.
    apiEnv.FCM_DRY_RUN = true;
  });

  it(
    'authenticates with Google and has FCM reject a bogus token',
    async () => {
      const bogus = 'e2e-not-a-real-registration-token';

      const result = await dispatchFcm({
        tokens: [bogus],
        title: 'Borradh FCM transport check',
        body: 'validate_only — never delivered.',
        userId: 'integration-test',
      });

      // This single assertion is the whole point of the test, because the two
      // failure modes are distinguishable:
      //
      //   - If the OAuth2 flow were wrong (bad `aud`, wrong scope, malformed
      //     assertion, wrong signing key) `getAccessToken` throws, dispatchFcm
      //     catches it, and we get failed=1 with invalidTokens EMPTY.
      //   - If the flow is right, the request reaches FCM authenticated, FCM
      //     rejects the TOKEN, and our error parsing maps it into invalidTokens.
      //
      // So a populated invalidTokens proves: JWT signing, `aud`, `scope`, the
      // token exchange, the v1 URL and project path, the error envelope shape,
      // and the errorCode -> permanently-invalid mapping. All of it, in one go.
      expect(result.invalidTokens).toEqual([bogus]);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      // An unconfigured/unauthenticated run reports configError instead.
      expect(result.configError).toBeUndefined();
    },
    TIMEOUT
  );

  it(
    'reuses one access token across separate dispatch calls',
    async () => {
      // Not a correctness proof so much as a cost one: a token exchange per
      // push would triple the latency of every notification fan-out.
      const input = {
        tokens: ['e2e-not-a-real-registration-token'],
        title: 'Borradh FCM transport check',
        body: 'validate_only — never delivered.',
        userId: 'integration-test',
      };

      const first = await dispatchFcm(input);
      const started = Date.now();
      const second = await dispatchFcm(input);
      const secondCallMs = Date.now() - started;

      expect(first.invalidTokens).toEqual(second.invalidTokens);
      // The second call skips the token endpoint entirely, so it is one HTTP
      // round trip rather than two. Generous bound — this is a smoke check on
      // the cache, not a benchmark.
      expect(secondCallMs).toBeLessThan(10_000);
    },
    TIMEOUT
  );
});

/**
 * The strongest available assertion, but it needs a real registration token,
 * so it is gated separately.
 *
 * With a bogus token FCM returns INVALID_ARGUMENT — which is *also* what it
 * returns if one of our message fields is misnamed. That ambiguity is the one
 * hole the block above cannot close. A real token turns the same validate_only
 * call into a 200, which can only happen if every field we send
 * (`message.token`, `.notification.title/body`, `.data`, `.android.priority`,
 * `.android.notification.sound`) is one FCM actually accepts.
 */
describe.runIf(serviceAccountBase64 && realDeviceToken)(
  'dispatchFcm (real FCM v1, real device token)',
  () => {
    beforeEach(() => {
      __resetFcmStateForTests();
      apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = serviceAccountBase64;
      apiEnv.FCM_DRY_RUN = true;
    });

    it(
      'has FCM accept the full payload, including data and android blocks',
      async () => {
        const result = await dispatchFcm({
          tokens: [realDeviceToken as string],
          title: 'Borradh FCM payload check',
          body: 'validate_only — never delivered.',
          data: { kind: 'integration-test', leadId: 42 } as unknown as Record<
            string,
            string
          >,
          userId: 'integration-test',
        });

        expect(result).toEqual({ sent: 1, failed: 0, invalidTokens: [] });
      },
      TIMEOUT
    );
  }
);
