/**
 * `GET /integrations/facebook/webhook` — the Meta hub-challenge handshake.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE OTHER FOUR
 * ---------------------------------------------------
 * Meta's handshake was implemented five times in this codebase. Four of those
 * copies were collapsed into one `HubChallenge` guard. This is the fifth, and
 * it could NOT be collapsed with them, because it does not behave the same way:
 *
 *     const expectedToken = apiEnv.META_WEBHOOK_VERIFY_TOKEN;
 *     if (mode === 'subscribe' && verifyToken === expectedToken) return challenge;
 *
 * It differs from the guard in two ways, and the second one is a real hole:
 *
 *   1. `===` rather than a constant-time compare. A timing side channel on a
 *      static token — minor, but the guard does not have it.
 *
 *   2. NO "token not configured" check. The guard treats an unset
 *      `META_WEBHOOK_VERIFY_TOKEN` as a misconfiguration and refuses. Here,
 *      unset means `expectedToken === undefined` — and a caller who simply
 *      OMITS `hub.verify_token` also gets `undefined`. `undefined === undefined`
 *      is true, so the endpoint verifies itself to anyone who asks, and Meta's
 *      subscription handshake can be completed by an arbitrary caller.
 *
 * Routing it through the guard would turn that into a 500 on a live endpoint,
 * which is a deliberate behaviour change that deserves its own commit rather
 * than a free ride on a refactor. So it is left exactly as found — and pinned
 * here, following the convention `webhook-signatures.int-spec.ts` established
 * for the Svix replay-window gap.
 *
 * THESE ASSERTIONS ARE A CHARACTERIZATION OF A GAP, NOT AN ENDORSEMENT OF IT.
 * The bypass case is deliberately written to FAIL LOUDLY the moment someone
 * fixes it, because that is exactly the right place to have the conversation —
 * rather than discovering later that a security fix silently changed a live
 * webhook's contract with Meta.
 */
import { Test } from '@nestjs/testing';
import request from 'supertest';

/* ------------------------------------------------------------------ */
/* Env proxy. Overrides CONFIG ONLY — never the verification code.     */
/* ------------------------------------------------------------------ */

jest.mock('@borradh-workspace/env/api', () => {
  const actual = jest.requireActual('@borradh-workspace/env/api');
  const g = globalThis as unknown as {
    __fbVerifyEnvOverrides?: Record<string, unknown>;
  };
  g.__fbVerifyEnvOverrides = g.__fbVerifyEnvOverrides ?? {};
  const overrides = g.__fbVerifyEnvOverrides;
  return {
    apiEnv: new Proxy(
      {},
      {
        get: (_target, key: string) =>
          key in overrides
            ? overrides[key]
            : (actual.apiEnv as Record<string, unknown>)[key],
      }
    ),
  };
});

const envOverrides: Record<string, unknown> = (() => {
  const g = globalThis as unknown as {
    __fbVerifyEnvOverrides?: Record<string, unknown>;
  };
  g.__fbVerifyEnvOverrides = g.__fbVerifyEnvOverrides ?? {};
  return g.__fbVerifyEnvOverrides;
})();

// Imported AFTER the env mock is registered (jest hoists `jest.mock`).
import { IntegrationsController } from '../integrations/integrations.controller.js';

const PATH = '/integrations/facebook/webhook';
const CONFIGURED_TOKEN = 'meta-verify-token-configured';

let app: Awaited<ReturnType<typeof buildApp>>;

async function buildApp() {
  const moduleRef = await Test.createTestingModule({
    controllers: [IntegrationsController],
  }).compile();
  const nestApp = moduleRef.createNestApplication();
  await nestApp.init();
  return nestApp;
}

beforeEach(async () => {
  for (const key of Object.keys(envOverrides)) delete envOverrides[key];
});

afterEach(async () => {
  await app?.close();
});

describe('Facebook hub-challenge verification', () => {
  describe('with META_WEBHOOK_VERIFY_TOKEN configured (the normal case)', () => {
    beforeEach(async () => {
      envOverrides.META_WEBHOOK_VERIFY_TOKEN = CONFIGURED_TOKEN;
      app = await buildApp();
    });

    it('echoes hub.challenge when mode and token are both correct', async () => {
      const res = await request(app.getHttpServer()).get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': CONFIGURED_TOKEN,
        'hub.challenge': 'nonce-12345',
      });

      expect(res.status).toBe(200);
      expect(res.text).toBe('nonce-12345');
    });

    it('rejects a wrong token with 403', async () => {
      const res = await request(app.getHttpServer()).get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'not-the-token',
        'hub.challenge': 'nonce-12345',
      });

      expect(res.status).toBe(403);
    });

    it('rejects a missing token with 403', async () => {
      const res = await request(app.getHttpServer())
        .get(PATH)
        .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'nonce-12345' });

      expect(res.status).toBe(403);
    });

    it('rejects a mode other than "subscribe" with 403', async () => {
      const res = await request(app.getHttpServer()).get(PATH).query({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': CONFIGURED_TOKEN,
        'hub.challenge': 'nonce-12345',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('with META_WEBHOOK_VERIFY_TOKEN UNSET — the gap', () => {
    beforeEach(async () => {
      envOverrides.META_WEBHOOK_VERIFY_TOKEN = undefined;
      app = await buildApp();
    });

    /**
     * THE BYPASS. Unset config + omitted param both read as `undefined`, and
     * `undefined === undefined` passes the check, so the handshake succeeds for
     * a caller who supplied no credential at all.
     *
     * The other four hub-challenge implementations refuse this (their guard
     * treats unset config as a misconfiguration). Pinned rather than fixed
     * because fixing it changes a live endpoint's response; WHEN it is fixed,
     * this test SHOULD fail and be replaced with a 403/500 expectation.
     */
    it('CURRENTLY ECHOES the challenge to a caller supplying NO token (200) — unset config is not treated as a refusal', async () => {
      const res = await request(app.getHttpServer())
        .get(PATH)
        .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'attacker-nonce' });

      expect(res.status).toBe(200);
      expect(res.text).toBe('attacker-nonce');
    });

    it('still rejects a caller who supplies a NON-EMPTY token (403)', async () => {
      // Only the all-undefined coincidence slips through; any actual value
      // fails the comparison. That narrowness is why it went unnoticed.
      const res = await request(app.getHttpServer()).get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'anything',
        'hub.challenge': 'attacker-nonce',
      });

      expect(res.status).toBe(403);
    });
  });
});
