import { apiEnv } from '@borradh-workspace/env/api';
import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger, logError } from '@borradh-workspace/observability';
import jwt from 'jsonwebtoken';

import type { DispatchInput, DispatchResult } from './types.js';

const logger = createLogger('notifications.fcm');

// Talk to FCM's HTTP v1 API directly rather than through firebase-admin.
// firebase-admin drags in @google-cloud/firestore and @firebase/database as
// hard dependencies — ~28MB of the api/worker images — to send what is, on the
// wire, one authenticated POST per token. There is no lighter subpath: those
// packages are unconditional deps of firebase-admin, not optional extras.
const FCM_SEND_HOST = 'https://fcm.googleapis.com';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

// Refresh a minute early so a token can't expire mid-flight.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

// `null` = not parsed yet, `false` = parse attempted and failed (credentials
// missing or malformed), so we warn once rather than on every send.
let serviceAccount: ServiceAccountJson | null | false = null;
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Reset module-level caches. Test-only. */
export function __resetFcmStateForTests(): void {
  serviceAccount = null;
  cachedToken = null;
}

function getServiceAccount(): ServiceAccountJson | null {
  if (serviceAccount === false) return null;
  if (serviceAccount) return serviceAccount;

  const base64 = apiEnv.FCM_SERVICE_ACCOUNT_BASE64;
  if (!base64) {
    logger.warn(
      'FCM_SERVICE_ACCOUNT_BASE64 not set — Android push delivery disabled'
    );
    serviceAccount = false;
    return null;
  }

  try {
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as ServiceAccountJson;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      throw new Error(
        'service account JSON missing client_email, private_key or project_id'
      );
    }
    serviceAccount = parsed;
    return serviceAccount;
  } catch (error) {
    logError('notifications.fcm.init', error, { feature: 'notifications' });
    serviceAccount = false;
    return null;
  }
}

/**
 * Mint (and cache) an OAuth2 access token for the service account.
 *
 * The standard two-legged JWT-bearer flow firebase-admin ran for us: sign a
 * short-lived assertion with the service account's private key, exchange it
 * for a bearer token good for an hour.
 */
async function getAccessToken(account: ServiceAccountJson): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > now) {
    return cachedToken.accessToken;
  }

  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI;
  const issuedAt = Math.floor(now / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    account.private_key,
    { algorithm: 'RS256' }
  );

  const response = await fetchWithRetry(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `FCM token exchange failed (${response.status})${
        detail ? `: ${detail.slice(0, 300)}` : ''
      }`
    );
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new Error('FCM token exchange returned no access_token');
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

// FCM v1 error codes that mean the token is permanently dead. These are the v1
// spellings of the firebase-admin codes this module used to match on
// (messaging/registration-token-not-registered, /invalid-registration-token,
// /invalid-argument).
const PERMANENTLY_INVALID = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
]);

function extractErrorCode(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const details = (error as { details?: unknown }).details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const code = (detail as { errorCode?: unknown })?.errorCode;
      if (typeof code === 'string') return code;
    }
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'string' ? status : undefined;
}

export async function dispatchFcm(
  input: DispatchInput
): Promise<DispatchResult> {
  const { tokens, title, body, data, userId } = input;
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const account = getServiceAccount();
  if (!account) {
    // Credentials not configured — treat as failure but do NOT mark tokens
    // invalid (they may work once ops drops the service-account JSON in).
    return {
      sent: 0,
      failed: tokens.length,
      invalidTokens: [],
      configError: 'FCM not configured (FCM_SERVICE_ACCOUNT_BASE64)',
    };
  }

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  try {
    const accessToken = await getAccessToken(account);

    const stringData = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
      : undefined;

    // `validate_only` has FCM check credentials, payload and every token, then
    // deliver nothing — the v1 spelling of firebase-admin's `dryRun`. Preview
    // sets it, because FCM has no sandbox endpoint to point at the way APNs
    // does, and preview databases are copy-on-write forks of prod — so the rows
    // in `device_push_token` are real customers' real devices.
    const dryRun = apiEnv.FCM_DRY_RUN;
    if (dryRun) {
      logger.warn(
        `FCM_DRY_RUN is on — validating ${tokens.length} token(s), delivering nothing`
      );
    }

    const url = `${FCM_SEND_HOST}/v1/projects/${encodeURIComponent(
      account.project_id
    )}/messages:send`;

    // Per-token sends so we can map per-token error codes back to invalid
    // tokens — the same shape firebase-admin's sendEachForMulticast gave us,
    // which also fanned out one request per token under the hood.
    const results = await Promise.all(
      tokens.map(async (token) => {
        const response = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              ...(stringData ? { data: stringData } : {}),
              android: {
                priority: 'high',
                notification: { sound: 'default' },
              },
            },
            ...(dryRun ? { validate_only: true } : {}),
          }),
        });

        if (response.ok) return { token, ok: true as const };

        const payload = await response.json().catch(() => undefined);
        return { token, ok: false as const, code: extractErrorCode(payload) };
      })
    );

    for (const result of results) {
      if (result.ok) {
        sent++;
        continue;
      }
      failed++;
      if (result.code && PERMANENTLY_INVALID.has(result.code)) {
        invalidTokens.push(result.token);
      }
    }
  } catch (error) {
    logError('notifications.fcm.send', error, {
      feature: 'notifications',
      extra: { userId, tokenCount: tokens.length },
    });
    failed += tokens.length - sent;
  }

  return { sent, failed, invalidTokens };
}
