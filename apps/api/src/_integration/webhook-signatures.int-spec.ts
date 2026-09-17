import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
/**
 * CHARACTERIZATION — webhook signature verification (HTTP, end to end).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Signature verification currently lives INLINE in five webhook controllers
 * (`assertValidSignature` private methods / inline HMAC blocks). It is about to
 * be extracted into `@UseGuards(...)`. The hazard that extraction creates is
 * specific and severe: every provider except Twilio signs the RAW REQUEST BODY,
 * before JSON parsing. A guard that reads `request.body` (parsed + re-
 * serialized) computes a DIFFERENT digest than a guard that reads
 * `request.rawBody`, and the failure mode is not always "reject everything" —
 * with a sloppy `?? ''` fallback it can become "accept everything", which is a
 * silent authentication bypass on five public, unauthenticated endpoints.
 *
 * These tests are the net. They drive the REAL Nest HTTP pipeline over
 * supertest and compute REAL signatures with the same algorithm the providers
 * use. Nothing about verification is mocked — that is the thing under test.
 *
 * WHY A LOCAL APP BUILDER INSTEAD OF `buildControllerApp`
 * ------------------------------------------------------
 * `harness.buildControllerApp` calls `createNestApplication()` with no options,
 * so `request.rawBody` is `undefined`. Production (`main.ts`) boots with
 * `{ rawBody: true }`. Using the harness as-is would make every raw-body test
 * vacuous (empty body, empty digest). `buildWebhookApp` below mirrors the
 * harness exactly EXCEPT it passes `{ rawBody: true }`, i.e. it reproduces
 * production. Webhook controllers are unauthenticated, so no identity/guard
 * plumbing is needed at all.
 *
 * WHY THE ENV IS PROXIED
 * ----------------------
 * The controllers read secrets from the eagerly-validated `apiEnv` singleton at
 * REQUEST time. The suite must supply known secrets (and must be able to flip
 * `NODE_ENV` to prove the fail-closed branch) without depending on whatever is
 * in the developer's local `.env`. The mock below is a thin PROXY over the real
 * `apiEnv` — it substitutes CONFIGURATION only. The HMAC code paths under test
 * are entirely real.
 *
 * SCHEMES PINNED HERE (read off the controllers, not from provider docs)
 * ---------------------------------------------------------------------
 *  - Twilio          HMAC-SHA1(TWILIO_AUTH_TOKEN, url + concat(sorted k+v of
 *                    the POST form params)) → base64, header
 *                    `X-Twilio-Signature`. Signs PARSED FORM PARAMS + the
 *                    reconstructed URL — NOT raw bytes. This is correct for
 *                    Twilio and is the one provider a parsed body is right for.
 *  - Resend (Svix)   HMAC-SHA256(base64-decoded RESEND_WEBHOOK_SECRET minus the
 *                    `whsec_` prefix, `${svix-id}.${svix-timestamp}.${RAW}`)
 *                    → base64, header `svix-signature` = `v1,<sig>` list.
 *  - Meta            `sha256=` + hex HMAC-SHA256(META_APP_SECRET, RAW), header
 *                    `x-hub-signature-256`. META_INSTAGRAM_APP_SECRET is
 *                    accepted as an alternate key.
 *  - WhatsApp        Same as Meta but META_APP_SECRET ONLY (no Instagram key).
 *  - Google Calendar NO signature at all — a static shared secret compared in
 *                    constant time from `x-goog-channel-token`.
 */
import { Test } from '@nestjs/testing';
import request from 'supertest';

/* ------------------------------------------------------------------ */
/* Env proxy. Overrides CONFIG ONLY — never the verification code.     */
/* ------------------------------------------------------------------ */

jest.mock('@borradh-workspace/env/api', () => {
  const actual = jest.requireActual('@borradh-workspace/env/api');
  const g = globalThis as unknown as {
    __webhookEnvOverrides?: Record<string, unknown>;
  };
  g.__webhookEnvOverrides = g.__webhookEnvOverrides ?? {};
  const overrides = g.__webhookEnvOverrides;
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
    __webhookEnvOverrides?: Record<string, unknown>;
  };
  g.__webhookEnvOverrides = g.__webhookEnvOverrides ?? {};
  return g.__webhookEnvOverrides;
})();

import { ResendWebhooksController } from '../campaigns/resend-webhooks.controller.js';
import { TwilioWebhooksController } from '../campaigns/twilio-webhooks.controller.js';
// Imported AFTER the env mock is registered (jest hoists `jest.mock`).
import { GoogleCalendarWebhooksController } from '../webhooks/google-calendar/google-calendar-webhooks.controller.js';
import { MetaWebhooksController } from '../webhooks/meta/meta-webhooks.controller.js';
import { WhatsAppWebhooksController } from '../webhooks/whatsapp/whatsapp-webhooks.controller.js';

/* ------------------------------------------------------------------ */
/* Local app builder — production parity: rawBody: true.               */
/* ------------------------------------------------------------------ */

async function buildWebhookApp(
  // biome-ignore lint/suspicious/noExplicitAny: Nest controller class token
  controller: any
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [controller],
  }).compile();

  // The ONLY difference from harness.buildControllerApp: `rawBody: true`,
  // exactly as apps/api/src/main.ts boots the real app. Without it every
  // raw-body signature test would silently verify the empty string.
  // NOTE: options MUST be the FIRST argument. `TestingModule.createNestApplication`
  // treats arg 1 as an http adapter only when it quacks like one; passing
  // `(undefined, options)` silently DISCARDS the options and rawBody stays
  // undefined, which makes every raw-body assertion below vacuous.
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return app;
}

/* ------------------------------------------------------------------ */
/* Known-good secrets + reference signers.                             */
/* ------------------------------------------------------------------ */

const TWILIO_TOKEN = 'integration-twilio-auth-token';
const SVIX_SECRET_B64 = Buffer.from('integration-svix-signing-key').toString(
  'base64'
);
const RESEND_SECRET = `whsec_${SVIX_SECRET_B64}`;
const META_SECRET = 'integration-meta-app-secret';
const META_IG_SECRET = 'integration-meta-instagram-app-secret';
const GCAL_TOKEN = 'integration-google-calendar-channel-token';

/** Twilio: HMAC-SHA1 over url + every param sorted by key, concatenated. */
function twilioSign(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** Svix: HMAC-SHA256 over `id.timestamp.rawBody`, key = decoded secret. */
function svixSign(
  secretB64: string,
  id: string,
  timestamp: string,
  rawBody: string
): string {
  const key = Buffer.from(secretB64, 'base64');
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

/** Meta / WhatsApp: `sha256=` + hex HMAC-SHA256 over the raw body. */
function metaSign(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

beforeEach(() => {
  for (const key of Object.keys(envOverrides)) delete envOverrides[key];
  // Non-production by default: this is what the fail-OPEN branches key off.
  envOverrides.NODE_ENV = 'test';
});

/* ================================================================== */
/* Twilio — HMAC-SHA1 over URL + sorted form params.                   */
/* ================================================================== */

describe('Twilio inbound-SMS webhook signature', () => {
  const PATH = '/webhooks/twilio/sms';
  const HOST = 'api.integration.test';
  const URL = `https://${HOST}${PATH}`;
  const PARAMS = {
    From: '+15551230000',
    To: '+15559990000',
    Body: 'STOP',
    MessageSid: 'SM_integration_1',
  };

  let app: INestApplication;

  beforeEach(async () => {
    envOverrides.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
    app = await buildWebhookApp(TwilioWebhooksController);
  });
  afterEach(async () => {
    await app?.close();
  });

  const post = () =>
    request(app.getHttpServer())
      .post(PATH)
      .set('Host', HOST)
      .set('x-forwarded-proto', 'https')
      .type('form');

  // PROPERTY 1: a genuinely-signed Twilio request is ACCEPTED. If the refactor
  // reconstructs the signed URL differently (drops x-forwarded-proto, uses the
  // socket host) or loses params, this goes red.
  it('accepts a correctly-signed request (200 + TwiML)', async () => {
    const res = await post()
      .set('x-twilio-signature', twilioSign(TWILIO_TOKEN, URL, PARAMS))
      .send(PARAMS);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response></Response>');
  });

  // PROPERTY 2 (LOAD-BEARING): a forged signature is REFUSED with 403. If the
  // guard refactor ever "fails open", this is the test that catches it.
  it('rejects a forged signature with 403', async () => {
    const res = await post()
      .set('x-twilio-signature', 'Zm9yZ2VkLXNpZ25hdHVyZS12YWx1ZQ==')
      .send(PARAMS);

    expect(res.status).toBe(403);
  });

  // PROPERTY 3: absence of the header is a refusal, not a pass-through.
  it('rejects a missing X-Twilio-Signature header with 403', async () => {
    const res = await post().send(PARAMS);
    expect(res.status).toBe(403);
  });

  // PROPERTY 4 (BODY TAMPERING): sign STOP, deliver START. Twilio signs the
  // PARAMS, so flipping a param after signing must invalidate the digest —
  // otherwise an attacker could flip a lead's consent state at will.
  it('rejects a body tampered with after signing (STOP → START) with 403', async () => {
    const signature = twilioSign(TWILIO_TOKEN, URL, PARAMS);
    const res = await post()
      .set('x-twilio-signature', signature)
      .send({ ...PARAMS, Body: 'START' });

    expect(res.status).toBe(403);
  });

  // PROPERTY 4b: the URL is inside the signed content. A signature minted for
  // another host must not be replayable against ours.
  it('rejects a signature minted for a different URL with 403', async () => {
    const res = await post()
      .set(
        'x-twilio-signature',
        twilioSign(TWILIO_TOKEN, `https://evil.example.com${PATH}`, PARAMS)
      )
      .send(PARAMS);

    expect(res.status).toBe(403);
  });

  // PROPERTY 5 (CONFIG): with no auth token configured, non-production FAILS
  // OPEN by design (local dev). Pinned so the refactor keeps the dev ergonomics
  // it was written for — and so any change to it is deliberate.
  it('fails OPEN (200) when TWILIO_AUTH_TOKEN is unset in non-production', async () => {
    await app.close();
    envOverrides.TWILIO_AUTH_TOKEN = undefined;
    app = await buildWebhookApp(TwilioWebhooksController);

    const res = await post().send(PARAMS);
    expect(res.status).toBe(200);
  });

  // PROPERTY 5b (CONFIG): in production the same missing-token condition FAILS
  // CLOSED with 500. An unverifiable webhook is never processed in prod.
  it('fails CLOSED (500) when TWILIO_AUTH_TOKEN is unset in production', async () => {
    await app.close();
    envOverrides.TWILIO_AUTH_TOKEN = undefined;
    envOverrides.NODE_ENV = 'production';
    app = await buildWebhookApp(TwilioWebhooksController);

    const res = await post().send(PARAMS);
    expect(res.status).toBe(500);
  });
});

/* ================================================================== */
/* Resend (Svix) — HMAC-SHA256 over `id.timestamp.RAW BODY`.           */
/* ================================================================== */

describe('Resend (Svix) webhook signature', () => {
  const PATH = '/webhooks/resend';
  const RAW = JSON.stringify({
    type: 'email.bounced',
    data: { email_id: 'msg_integration_1', to: 'someone@example.com' },
  });
  const SVIX_ID = 'msg_2integration';

  let app: INestApplication;

  beforeEach(async () => {
    envOverrides.RESEND_WEBHOOK_SECRET = RESEND_SECRET;
    app = await buildWebhookApp(ResendWebhooksController);
  });
  afterEach(async () => {
    await app?.close();
  });

  const nowSeconds = () => String(Math.floor(Date.now() / 1000));

  const post = (raw: string) =>
    request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .send(raw);

  // PROPERTY 1: a genuinely-signed payload is ACCEPTED (200). Svix signs the
  // raw bytes, so this passing at all proves the verifier is reading rawBody.
  it('accepts a correctly-signed raw payload (200)', async () => {
    const ts = nowSeconds();
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // PROPERTY 2 (LOAD-BEARING): a forged signature is refused with 403.
  it('rejects a forged signature with 403', async () => {
    const ts = nowSeconds();
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', 'v1,Zm9yZ2VkLXN2aXgtc2lnbmF0dXJlLXZhbHVlAAAA');

    expect(res.status).toBe(403);
  });

  // PROPERTY 3: every one of the three Svix headers is load-bearing; dropping
  // any of them must refuse, not fall through to a default.
  it('rejects a missing svix-signature header with 403', async () => {
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', nowSeconds());

    expect(res.status).toBe(403);
  });

  it('rejects a missing svix-id header with 403', async () => {
    const ts = nowSeconds();
    const res = await post(RAW)
      .set('svix-timestamp', ts)
      .set('svix-signature', svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW));

    expect(res.status).toBe(403);
  });

  it('rejects a missing svix-timestamp header with 403', async () => {
    const ts = nowSeconds();
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-signature', svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW));

    expect(res.status).toBe(403);
  });

  // PROPERTY 4 (RAW-BODY TAMPERING — the guard-refactor canary): sign one byte
  // sequence, deliver another that is semantically identical after JSON parse.
  // The two payloads differ ONLY in whitespace, so they parse to the SAME
  // object. A verifier that re-serializes `request.body` cannot tell them
  // apart and will WRONGLY ACCEPT this. A verifier reading rawBody rejects it.
  it('rejects a whitespace-only raw-body change after signing with 403 (raw-vs-parsed canary)', async () => {
    const ts = nowSeconds();
    const signature = svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW);
    const reserialized = JSON.stringify(JSON.parse(RAW), null, 2); // same object, different bytes

    const res = await post(reserialized)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', signature);

    expect(res.status).toBe(403);
  });

  // PROPERTY 4b: a substantive body edit after signing is refused.
  it('rejects a substantively tampered body with 403', async () => {
    const ts = nowSeconds();
    const signature = svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW);
    const tampered = RAW.replace('someone@example.com', 'attacker@example.com');

    const res = await post(tampered)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', signature);

    expect(res.status).toBe(403);
  });

  // PROPERTY 5 (REPLAY WINDOW). This block used to pin the OPPOSITE — a
  // year-stale timestamp returning 200 — as an explicit "CHARACTERIZATION OF A
  // GAP, NOT AN ENDORSEMENT", closing with: adding a window "will fail here
  // loudly, which is the correct place to have that conversation." This is that
  // conversation, had. `verifySvixSignature` now enforces Svix's documented
  // ±300s tolerance, and the pin is inverted deliberately.
  //
  // Both directions are covered. A past-only check would still let a single
  // captured delivery be minted with a far-future timestamp and replayed for
  // years — the same defect wearing a different sign.
  //
  // Each case re-signs AT its own timestamp, so the HMAC is valid and the only
  // possible reason for a 403 is the window. Signing at a different timestamp
  // than the header carries would fail on the digest instead and would prove
  // nothing about the clock.
  it.each([
    ['a year stale -> 403', -365 * 24 * 60 * 60, 403],
    ['an hour in the future -> 403', 60 * 60, 403],
    ['299s old, inside the window -> 200', -299, 200],
  ])('svix-timestamp %s', async (_label, offsetSeconds, expected) => {
    const ts = String(Math.floor(Date.now() / 1000) + offsetSeconds);
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW));

    expect(res.status).toBe(expected);
  });

  // Number('nope') is NaN, NaN comparisons are all false, so a non-numeric
  // header would sail straight through an arithmetic-only window check.
  it('rejects a non-numeric svix-timestamp (403)', async () => {
    const ts = 'not-a-number';
    const res = await post(RAW)
      .set('svix-id', SVIX_ID)
      .set('svix-timestamp', ts)
      .set('svix-signature', svixSign(SVIX_SECRET_B64, SVIX_ID, ts, RAW));

    expect(res.status).toBe(403);
  });

  // PROPERTY 6 (CONFIG): fail OPEN in non-production, fail CLOSED in prod.
  it('fails OPEN (200) when RESEND_WEBHOOK_SECRET is unset in non-production', async () => {
    await app.close();
    envOverrides.RESEND_WEBHOOK_SECRET = undefined;
    app = await buildWebhookApp(ResendWebhooksController);

    const res = await post(RAW);
    expect(res.status).toBe(200);
  });

  it('fails CLOSED (500) when RESEND_WEBHOOK_SECRET is unset in production', async () => {
    await app.close();
    envOverrides.RESEND_WEBHOOK_SECRET = undefined;
    envOverrides.NODE_ENV = 'production';
    app = await buildWebhookApp(ResendWebhooksController);

    const res = await post(RAW);
    expect(res.status).toBe(500);
  });
});

/* ================================================================== */
/* Meta — X-Hub-Signature-256 (sha256=hex) over the RAW body.          */
/* ================================================================== */

describe('Meta webhook X-Hub-Signature-256', () => {
  // `object: 'page'` with NO `entry` array: the controller verifies the
  // signature, then acknowledges without dispatching to any handler. That keeps
  // these tests about SIGNATURES and nothing else.
  const RAW = JSON.stringify({ object: 'page' });

  let app: INestApplication;

  beforeEach(async () => {
    envOverrides.META_APP_SECRET = META_SECRET;
    envOverrides.META_INSTAGRAM_APP_SECRET = undefined;
    app = await buildWebhookApp(MetaWebhooksController);
  });
  afterEach(async () => {
    await app?.close();
  });

  const post = (path: string, raw: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('content-type', 'application/json')
      .send(raw);

  for (const path of ['/webhooks/meta/leadgen', '/webhooks/meta/messaging']) {
    describe(path, () => {
      // PROPERTY 1: a correctly-signed payload is accepted (201 = Nest's
      // default POST status; these routes declare no @HttpCode).
      it('accepts a correctly-signed raw payload (201)', async () => {
        const res = await post(path, RAW).set(
          'x-hub-signature-256',
          metaSign(META_SECRET, RAW)
        );

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, processedCount: 0 });
      });

      // PROPERTY 2 (LOAD-BEARING): forged signature → 403.
      it('rejects a forged signature with 403', async () => {
        const res = await post(path, RAW).set(
          'x-hub-signature-256',
          `sha256=${'0'.repeat(64)}`
        );

        expect(res.status).toBe(403);
      });

      // PROPERTY 2b: a signature computed with the WRONG secret is refused.
      // This is what an attacker who knows the algorithm but not the app secret
      // actually sends.
      it('rejects a signature computed with the wrong secret with 403', async () => {
        const res = await post(path, RAW).set(
          'x-hub-signature-256',
          metaSign('not-the-real-app-secret', RAW)
        );

        expect(res.status).toBe(403);
      });

      // PROPERTY 3: missing header → explicit 403 (the controller checks for
      // the header before comparing, so this is a clean refusal).
      it('rejects a missing x-hub-signature-256 header with 403', async () => {
        const res = await post(path, RAW);
        expect(res.status).toBe(403);
      });

      // PROPERTY 4 (RAW-BODY CANARY): re-serialised, semantically identical
      // bytes. A guard reading the PARSED body would accept this; the raw-body
      // implementation must reject it.
      it('rejects a whitespace-only raw-body change after signing with 403 (raw-vs-parsed canary)', async () => {
        const signature = metaSign(META_SECRET, RAW);
        const reserialized = JSON.stringify(JSON.parse(RAW), null, 2);

        const res = await post(path, reserialized).set(
          'x-hub-signature-256',
          signature
        );

        expect(res.status).toBe(403);
      });

      // PROPERTY 4b: substantive tampering after signing → 403.
      it('rejects a substantively tampered body with 403', async () => {
        const signature = metaSign(META_SECRET, RAW);
        const res = await post(
          path,
          JSON.stringify({ object: 'instagram' })
        ).set('x-hub-signature-256', signature);

        expect(res.status).toBe(403);
      });

      // PROPERTY 6 (CONFIG): Meta ALWAYS fails closed on missing config — no
      // dev fail-open branch, in any NODE_ENV. 500, not 200.
      it('fails CLOSED (500) when META_APP_SECRET is unset, even in non-production', async () => {
        await app.close();
        envOverrides.META_APP_SECRET = undefined;
        app = await buildWebhookApp(MetaWebhooksController);

        const res = await post(path, RAW).set(
          'x-hub-signature-256',
          metaSign(META_SECRET, RAW)
        );

        expect(res.status).toBe(500);
      });
    });
  }

  // PROPERTY 7 (ALTERNATE KEY): Instagram traffic may be signed with a SEPARATE
  // app secret. Both keys must be tried. If the refactor collapses the key list
  // to one secret, Instagram webhooks silently start 403-ing in production and
  // this test is the only thing that says so.
  it('accepts a payload signed with META_INSTAGRAM_APP_SECRET when configured (201)', async () => {
    await app.close();
    envOverrides.META_INSTAGRAM_APP_SECRET = META_IG_SECRET;
    app = await buildWebhookApp(MetaWebhooksController);

    const res = await request(app.getHttpServer())
      .post('/webhooks/meta/messaging')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', metaSign(META_IG_SECRET, RAW))
      .send(RAW);

    expect(res.status).toBe(201);
  });

  // PROPERTY 7b: the Instagram key is only honoured when it is CONFIGURED —
  // it is not a hardcoded second chance.
  it('rejects an Instagram-secret signature when META_INSTAGRAM_APP_SECRET is unset (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/meta/messaging')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', metaSign(META_IG_SECRET, RAW))
      .send(RAW);

    expect(res.status).toBe(403);
  });

  // PROPERTY 8: an empty body is rejected 400 BEFORE any signature work. Pinned
  // because a guard runs BEFORE the handler — moving verification into a guard
  // could change this 400 into a 403. Either is safe, but the change should be
  // deliberate and visible.
  it('rejects an empty payload with 400 (checked before signature verification)', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/meta/leadgen')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', metaSign(META_SECRET, ''))
      .send('');

    expect(res.status).toBe(400);
  });
});

/* ================================================================== */
/* WhatsApp Cloud API — X-Hub-Signature-256, META_APP_SECRET only.     */
/* ================================================================== */

describe('WhatsApp Cloud webhook X-Hub-Signature-256', () => {
  const PATH = '/webhooks/whatsapp';
  // `object` deliberately NOT 'whatsapp_business_account': the controller
  // verifies the signature, then acknowledges and returns without touching the
  // DB, Redis or Meta. Signature-only surface.
  const RAW = JSON.stringify({ object: 'not_whatsapp', entry: [] });

  let app: INestApplication;

  beforeEach(async () => {
    envOverrides.META_APP_SECRET = META_SECRET;
    envOverrides.META_INSTAGRAM_APP_SECRET = META_IG_SECRET;
    app = await buildWebhookApp(WhatsAppWebhooksController);
  });
  afterEach(async () => {
    await app?.close();
  });

  const post = (raw: string) =>
    request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .send(raw);

  // PROPERTY 1: correctly-signed payload accepted (201).
  it('accepts a correctly-signed raw payload (201)', async () => {
    const res = await post(RAW).set(
      'x-hub-signature-256',
      metaSign(META_SECRET, RAW)
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, processedCount: 0 });
  });

  // PROPERTY 2 (LOAD-BEARING): forged signature → 403.
  it('rejects a forged signature with 403', async () => {
    const res = await post(RAW).set(
      'x-hub-signature-256',
      `sha256=${'0'.repeat(64)}`
    );

    expect(res.status).toBe(403);
  });

  it('rejects a signature computed with the wrong secret with 403', async () => {
    const res = await post(RAW).set(
      'x-hub-signature-256',
      metaSign('not-the-real-app-secret', RAW)
    );

    expect(res.status).toBe(403);
  });

  // PROPERTY 2b: unlike the Meta controller, WhatsApp does NOT accept the
  // Instagram app secret — only META_APP_SECRET. Pinned so a shared guard does
  // not accidentally WIDEN the accepted key set for WhatsApp.
  it('rejects a signature made with META_INSTAGRAM_APP_SECRET with 403 (WhatsApp accepts META_APP_SECRET only)', async () => {
    const res = await post(RAW).set(
      'x-hub-signature-256',
      metaSign(META_IG_SECRET, RAW)
    );

    expect(res.status).toBe(403);
  });

  // PROPERTY 3 (MISSING HEADER) — CHARACTERIZING A ROUGH EDGE.
  // This controller calls safeCompare(signature, expected) with NO prior
  // presence check, so `Buffer.from(undefined)` THROWS and Nest maps it to 500.
  // The request is still REFUSED (fail-closed — no handler runs), but via a
  // crash rather than a deliberate 403, unlike every sibling controller. Pinned
  // at its CURRENT value: if the guard extraction normalises this to 403 that
  // is an improvement, and this test is where that shows up as an intentional
  // change instead of an accident.
  it('rejects a missing x-hub-signature-256 header with 500 (crash-refusal, not a 403 — see comment)', async () => {
    const res = await post(RAW);
    expect(res.status).toBe(500);
  });

  // PROPERTY 4 (RAW-BODY CANARY).
  it('rejects a whitespace-only raw-body change after signing with 403 (raw-vs-parsed canary)', async () => {
    const signature = metaSign(META_SECRET, RAW);
    const reserialized = JSON.stringify(JSON.parse(RAW), null, 2);

    const res = await post(reserialized).set('x-hub-signature-256', signature);
    expect(res.status).toBe(403);
  });

  // PROPERTY 4b: substantive tampering after signing → 403.
  it('rejects a substantively tampered body with 403', async () => {
    const signature = metaSign(META_SECRET, RAW);
    const res = await post(
      JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    ).set('x-hub-signature-256', signature);

    expect(res.status).toBe(403);
  });

  // PROPERTY 6 (CONFIG): always fails closed with 500 when unconfigured.
  it('fails CLOSED (500) when META_APP_SECRET is unset, even in non-production', async () => {
    await app.close();
    envOverrides.META_APP_SECRET = undefined;
    app = await buildWebhookApp(WhatsAppWebhooksController);

    const res = await post(RAW).set(
      'x-hub-signature-256',
      metaSign(META_SECRET, RAW)
    );

    expect(res.status).toBe(500);
  });

  // PROPERTY 8: empty body → 400 before signature work (see the Meta note).
  it('rejects an empty payload with 400 (checked before signature verification)', async () => {
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', metaSign(META_SECRET, ''))
      .send('');

    expect(res.status).toBe(400);
  });
});

/* ================================================================== */
/* Google Calendar — shared-secret channel token (NOT a signature).    */
/* ================================================================== */

describe('Google Calendar webhook channel token', () => {
  const PATH = '/webhooks/google-calendar';

  // NOT a signature scheme. Google Calendar push notifications carry NO body
  // and no HMAC; authenticity rests entirely on a static bearer-style secret
  // echoed back in `x-goog-channel-token` (the value we supplied at watch-
  // registration time), compared in constant time. There is therefore nothing
  // body-derived to tamper with — the raw-vs-parsed hazard does not apply here,
  // and no body-tampering test is possible or meaningful. What CAN be pinned is
  // accept / reject / missing / fail-closed, all below.
  let app: INestApplication;

  beforeEach(async () => {
    envOverrides.GOOGLE_CALENDAR_WEBHOOK_TOKEN = GCAL_TOKEN;
    app = await buildWebhookApp(GoogleCalendarWebhooksController);
  });
  afterEach(async () => {
    await app?.close();
  });

  const post = () =>
    request(app.getHttpServer())
      .post(PATH)
      .set('x-goog-channel-id', 'chan_integration_1')
      .set('x-goog-resource-state', 'exists')
      .set('x-goog-resource-id', 'res_integration_1');

  // PROPERTY 1: the correct token is accepted (200; @HttpCode(OK)).
  it('accepts the correct channel token (200)', async () => {
    const res = await post().set('x-goog-channel-token', GCAL_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // PROPERTY 2 (LOAD-BEARING): a wrong token is refused with 403.
  it('rejects a wrong channel token with 403', async () => {
    const res = await post().set('x-goog-channel-token', 'wrong-token-value');
    expect(res.status).toBe(403);
  });

  // PROPERTY 2b: a token that is a PREFIX of the real one must not pass. The
  // comparison length-checks before timingSafeEqual; a naive rewrite using
  // startsWith/slice would regress here.
  it('rejects a truncated (prefix) channel token with 403', async () => {
    const res = await post().set(
      'x-goog-channel-token',
      GCAL_TOKEN.slice(0, GCAL_TOKEN.length - 1)
    );
    expect(res.status).toBe(403);
  });

  // PROPERTY 3: missing token header → 403.
  it('rejects a missing x-goog-channel-token header with 403', async () => {
    const res = await post();
    expect(res.status).toBe(403);
  });

  // PROPERTY 6 (CONFIG): fails CLOSED with 500 when unconfigured, in every
  // environment — there is no dev fail-open branch here.
  it('fails CLOSED (500) when GOOGLE_CALENDAR_WEBHOOK_TOKEN is unset', async () => {
    await app.close();
    envOverrides.GOOGLE_CALENDAR_WEBHOOK_TOKEN = undefined;
    app = await buildWebhookApp(GoogleCalendarWebhooksController);

    const res = await post().set('x-goog-channel-token', GCAL_TOKEN);
    expect(res.status).toBe(500);
  });

  // PROPERTY 9 (ORDERING): the required Google headers are checked BEFORE the
  // token, and a request missing them is acknowledged 200 WITHOUT any token
  // check. This is a real short-circuit — pinned so a guard placed in front of
  // the handler (guards run before ANY handler code) does not silently turn
  // these acknowledgements into 403s and start Google's retry backoff.
  it('acknowledges 200 without checking the token when the required Google headers are absent', async () => {
    const res = await request(app.getHttpServer()).post(PATH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
