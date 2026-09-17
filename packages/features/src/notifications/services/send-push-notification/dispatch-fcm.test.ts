import { generateKeyPairSync } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';
import { setFetchInterceptor } from '@borradh-workspace/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// NOTE the import specifier. vite.config.ts aliases the exact specifier
// `./dispatch-fcm.js` to the canonical push-dispatcher mock, because the real
// `send-push-notification` service is pulled into the shared worker graph by
// other suites under `isolate: false`. This spec wants the REAL module, so it
// reaches it by a path that does not match that `^\./dispatch-…` alias.
import {
  __resetFcmStateForTests,
  dispatchFcm,
} from '../send-push-notification/dispatch-fcm.js';

// A real RSA key, so `jsonwebtoken` actually signs and we exercise the real
// assertion path rather than a mocked one. Generated once for the file.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT = {
  client_email: 'push@borradh-test.iam.gserviceaccount.com',
  private_key: privateKey,
  project_id: 'borradh-test',
  token_uri: 'https://oauth2.googleapis.com/token',
};

const TOKEN_URI = SERVICE_ACCOUNT.token_uri;
const SEND_URL =
  'https://fcm.googleapis.com/v1/projects/borradh-test/messages:send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Recorded {
  url: string;
  init: RequestInit;
}

/** Install an interceptor that serves the token exchange and lets a handler
 *  answer sends. Returns the recorded send requests. */
function intercept(
  sendHandler: (body: { message: { token: string } }) => Response
): Recorded[] {
  const sends: Recorded[] = [];
  setFetchInterceptor(async (url, init) => {
    if (url.startsWith(TOKEN_URI)) {
      return json({ access_token: 'ya29.test-token', expires_in: 3600 });
    }
    if (url === SEND_URL) {
      sends.push({ url, init });
      return sendHandler(JSON.parse(String(init.body)));
    }
    return null;
  });
  return sends;
}

const originalServiceAccount = apiEnv.FCM_SERVICE_ACCOUNT_BASE64;
const originalDryRun = apiEnv.FCM_DRY_RUN;

beforeEach(() => {
  __resetFcmStateForTests();
  apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = Buffer.from(
    JSON.stringify(SERVICE_ACCOUNT)
  ).toString('base64');
  apiEnv.FCM_DRY_RUN = false;
});

afterEach(() => {
  setFetchInterceptor(null);
  apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = originalServiceAccount;
  apiEnv.FCM_DRY_RUN = originalDryRun;
  __resetFcmStateForTests();
});

describe('dispatchFcm', () => {
  it('sends one authenticated request per token', async () => {
    const sends = intercept(() => json({ name: 'projects/x/messages/1' }));

    const result = await dispatchFcm({
      tokens: ['tok-a', 'tok-b'],
      title: 'Hi',
      body: 'There',
      userId: 'user-1',
    });

    expect(result).toEqual({ sent: 2, failed: 0, invalidTokens: [] });
    expect(sends).toHaveLength(2);
    for (const send of sends) {
      expect((send.init.headers as Record<string, string>).Authorization).toBe(
        'Bearer ya29.test-token'
      );
    }
    const tokens = sends.map(
      (s) => JSON.parse(String(s.init.body)).message.token
    );
    expect(tokens).toEqual(['tok-a', 'tok-b']);
  });

  it('marks UNREGISTERED tokens invalid and leaves transient ones alone', async () => {
    intercept((body) => {
      if (body.message.token === 'dead') {
        return json(
          {
            error: {
              status: 'NOT_FOUND',
              details: [{ errorCode: 'UNREGISTERED' }],
            },
          },
          404
        );
      }
      if (body.message.token === 'flaky') {
        return json({ error: { status: 'INTERNAL' } }, 500);
      }
      return json({ name: 'projects/x/messages/1' });
    });

    const result = await dispatchFcm({
      tokens: ['good', 'dead', 'flaky'],
      title: 'Hi',
      body: 'There',
      userId: 'user-1',
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(2);
    // `flaky` is a server-side blip — retrying later is right, deleting is not.
    expect(result.invalidTokens).toEqual(['dead']);
  });

  it('sets validate_only when FCM_DRY_RUN is on', async () => {
    apiEnv.FCM_DRY_RUN = true;
    const sends = intercept(() => json({ name: 'projects/x/messages/1' }));

    await dispatchFcm({
      tokens: ['tok-a'],
      title: 'Hi',
      body: 'There',
      userId: 'user-1',
    });

    expect(JSON.parse(String(sends[0].init.body)).validate_only).toBe(true);
  });

  it('stringifies data values, as FCM requires', async () => {
    const sends = intercept(() => json({ name: 'projects/x/messages/1' }));

    await dispatchFcm({
      tokens: ['tok-a'],
      title: 'Hi',
      body: 'There',
      data: { leadId: 42, kind: 'lead' } as unknown as Record<string, string>,
      userId: 'user-1',
    });

    expect(JSON.parse(String(sends[0].init.body)).message.data).toEqual({
      leadId: '42',
      kind: 'lead',
    });
  });

  it('reports a config error without invalidating tokens when unconfigured', async () => {
    apiEnv.FCM_SERVICE_ACCOUNT_BASE64 = undefined;
    __resetFcmStateForTests();

    const result = await dispatchFcm({
      tokens: ['tok-a', 'tok-b'],
      title: 'Hi',
      body: 'There',
      userId: 'user-1',
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.invalidTokens).toEqual([]);
    expect(result.configError).toMatch(/FCM not configured/);
  });

  it('reuses the access token across sends', async () => {
    let tokenExchanges = 0;
    setFetchInterceptor(async (url) => {
      if (url.startsWith(TOKEN_URI)) {
        tokenExchanges++;
        return json({ access_token: 'ya29.test-token', expires_in: 3600 });
      }
      if (url === SEND_URL) return json({ name: 'projects/x/messages/1' });
      return null;
    });

    const input = {
      tokens: ['tok-a'],
      title: 'Hi',
      body: 'There',
      userId: 'user-1',
    };
    await dispatchFcm(input);
    await dispatchFcm(input);

    expect(tokenExchanges).toBe(1);
  });
});
