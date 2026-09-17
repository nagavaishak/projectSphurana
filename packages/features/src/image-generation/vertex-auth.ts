/**
 * Vertex AI auth + endpoint resolution for the Gemini image models.
 *
 * WHY THIS EXISTS — it is a billing concern, not a technical one.
 *
 * The Gemini Developer API (AI Studio, `generativelanguage.googleapis.com`,
 * `?key=<API key>`) bills on its own track. Google Cloud credits cannot be
 * spent against it — for billing accounts created after 2026-03-02 the $300
 * Welcome credits are explicitly excluded. Calling the SAME models through
 * Vertex AI (`aiplatform.googleapis.com`) bills them as an ordinary Google
 * Cloud service, which means committed-use discounts and credits apply.
 *
 * Vertex uses IAM rather than API keys. Credentials resolve in this order:
 *
 *   1. Application Default Credentials (PREFERRED). ADC is a resolution CHAIN,
 *      not a GCP-only mechanism — one link is *external account* credentials,
 *      i.e. Workload Identity Federation. Point GOOGLE_APPLICATION_CREDENTIALS
 *      at a WIF config file and Fly/Vercel exchange their own OIDC token for
 *      short-lived GCP credentials, with NO long-lived key in existence.
 *      Locally this also picks up `gcloud auth application-default login`.
 *   2. An explicit base64 service-account key (GOOGLE_VERTEX_SA_KEY). Simpler
 *      to set up, but it is a long-lived secret that can leak and does not
 *      rotate itself. Prefer (1); this is the fallback.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger } from '@borradh-workspace/observability';
import { GoogleAuth, IdentityPoolClient } from 'google-auth-library';
import { FlyOidcSubjectTokenSupplier } from './fly-oidc-supplier.js';

const logger = createLogger('VertexAuth');

const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export type GeminiProvider = 'aistudio' | 'vertex';

/**
 * Provider selection, as a pure function of config.
 *
 * Explicit `forced` wins — that is the rollback lever, and it works without
 * having to unset credentials. Otherwise Vertex is selected only when it is
 * FULLY configured, so a half-finished setup degrades to the working AI Studio
 * path instead of failing every image generation.
 *
 * Kept pure (rather than reading `apiEnv` directly) so it is testable without
 * `vi.mock`-ing the env module, which leaks across files under the features
 * suite's `isolate: false`.
 */
export function selectGeminiProvider(config: {
  forced?: GeminiProvider;
  project?: string;
  /** Explicit base64 SA key — the fallback credential source. */
  serviceAccountKey?: string;
  /**
   * GOOGLE_APPLICATION_CREDENTIALS. Points at either a key file or a Workload
   * Identity Federation config — how ADC works off-GCP with no long-lived key.
   */
  adcCredentialsPath?: string;
  /**
   * GOOGLE_VERTEX_WIF_AUDIENCE — the workload identity pool provider. Set on
   * Fly, where the Machine's own OIDC token is federated. The best option:
   * no Google credential exists at all.
   */
  wifAudience?: string;
  /**
   * Whether the well-known ADC file exists (what `gcloud auth
   * application-default login` writes). That login does NOT set
   * GOOGLE_APPLICATION_CREDENTIALS, so without this the normal local-dev
   * setup would look credential-less and silently fall back to AI Studio.
   */
  adcWellKnownFile?: boolean;
}): GeminiProvider {
  if (config.forced) return config.forced;
  const hasCredentials = Boolean(
    config.wifAudience ||
      config.serviceAccountKey ||
      config.adcCredentialsPath ||
      config.adcWellKnownFile
  );
  return config.project && hasCredentials ? 'vertex' : 'aistudio';
}

/**
 * Path `gcloud auth application-default login` writes to. `CLOUDSDK_CONFIG`
 * overrides the location when set.
 */
export function adcWellKnownPath(): string {
  const configDir =
    process.env.CLOUDSDK_CONFIG ??
    join(process.env.HOME ?? '', '.config', 'gcloud');
  return join(configDir, 'application_default_credentials.json');
}

/**
 * Vertex `generateContent` URL for a publisher model. Pure, for the same
 * reason as above.
 *
 * The `global` location is served from the unprefixed host; every other
 * location uses a regional host. Gemini 3 image models are published on the
 * global endpoint, which is why that is the default.
 */
export function buildVertexUrl(config: {
  project: string;
  location: string;
  model: string;
}): string {
  const { project, location, model } = config;
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;
  return (
    `https://${host}/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`
  );
}

/** Env-bound wrapper around {@link selectGeminiProvider}. */
export function resolveGeminiProvider(): GeminiProvider {
  return selectGeminiProvider({
    forced: apiEnv.GEMINI_PROVIDER,
    project: apiEnv.GOOGLE_CLOUD_PROJECT,
    serviceAccountKey: apiEnv.GOOGLE_VERTEX_SA_KEY,
    adcCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    wifAudience: apiEnv.GOOGLE_VERTEX_WIF_AUDIENCE,
    adcWellKnownFile: existsSync(adcWellKnownPath()),
  });
}

/** Env-bound wrapper around {@link buildVertexUrl}. */
export function vertexGenerateContentUrl(model: string): string {
  return buildVertexUrl({
    project: apiEnv.GOOGLE_CLOUD_PROJECT ?? '',
    location: apiEnv.GOOGLE_CLOUD_LOCATION,
    model,
  });
}

/**
 * Cached auth client. Normalised to a token-getter because the three paths
 * return different client types. The libraries handle access-token refresh
 * internally; caching here only avoids rebuilding the client per image call.
 */
let tokenGetter: (() => Promise<string | null | undefined>) | null = null;
/** Cached setup failure — a malformed key or missing config will not fix
 *  itself, so don't retry (and re-log) on every single generation. */
let credentialsError: string | null = null;

function getAuth(): (() => Promise<string | null | undefined>) | null {
  if (tokenGetter) return tokenGetter;
  if (credentialsError) return null;

  const encoded = apiEnv.GOOGLE_VERTEX_SA_KEY;

  // PREFERRED PATH 1: Fly Workload Identity Federation. No Google credential
  // exists anywhere — the Machine's own OIDC token is exchanged for a
  // short-lived one. See fly-oidc-supplier.ts for why a custom supplier is
  // needed instead of a stock credential_source.
  const wifAudience = apiEnv.GOOGLE_VERTEX_WIF_AUDIENCE;
  if (wifAudience) {
    const saEmail = apiEnv.GOOGLE_VERTEX_SA_EMAIL;
    const client = new IdentityPoolClient({
      audience: wifAudience,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token_supplier: new FlyOidcSubjectTokenSupplier(),
      // Impersonation is optional: federated identities can be granted
      // aiplatform.user directly, but impersonating a service account keeps
      // the IAM grant in one familiar place.
      ...(saEmail && {
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
      }),
      scopes: [VERTEX_SCOPE],
    });
    tokenGetter = async () => (await client.getAccessToken()).token;
    return tokenGetter;
  }

  // PREFERRED PATH 2: no explicit key — let ADC resolve. Constructing
  // GoogleAuth with no credentials walks the standard chain:
  // GOOGLE_APPLICATION_CREDENTIALS (a key file OR a WIF config), THEN the
  // well-known gcloud file, then the GCE/Cloud Run metadata server.
  //
  // Do NOT pre-check GOOGLE_APPLICATION_CREDENTIALS here. `gcloud auth
  // application-default login` — the normal local-dev path — does not set that
  // variable; it writes the well-known file instead. Gating on the env var
  // rejected exactly the case ADC exists to serve. Let the library walk its own
  // chain and surface a failure at token time instead.
  if (!encoded) {
    const adc = new GoogleAuth({ scopes: [VERTEX_SCOPE] });
    tokenGetter = () => adc.getAccessToken();
    return tokenGetter;
  }

  // FALLBACK PATH: an explicit base64 service-account key.
  try {
    // Accept both base64 (what we document, because secret stores mangle the
    // newlines inside the JSON's private_key) and raw JSON, so a paste of the
    // key file straight from the console also works.
    const trimmed = encoded.trim();
    const json = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8');
    const credentials = JSON.parse(json) as {
      client_email?: string;
      private_key?: string;
    };
    if (!credentials.client_email || !credentials.private_key) {
      credentialsError =
        'GOOGLE_VERTEX_SA_KEY is missing client_email / private_key';
      return null;
    }
    const keyAuth = new GoogleAuth({ credentials, scopes: [VERTEX_SCOPE] });
    tokenGetter = () => keyAuth.getAccessToken();
    return tokenGetter;
  } catch (error) {
    // Deliberately does NOT include the decoded value or any part of it — the
    // key material must never reach a log line.
    credentialsError = `GOOGLE_VERTEX_SA_KEY could not be parsed: ${
      error instanceof Error ? error.message : 'unknown error'
    }`;
    return null;
  }
}

/**
 * Mint a Vertex access token. Returns `null` (never throws) when credentials
 * are absent or malformed so callers can degrade to a typed error rather than
 * surfacing an unhandled exception from an image job.
 */
export async function getVertexAccessToken(): Promise<string | null> {
  const getToken = getAuth();
  if (!getToken) {
    logger.error('Vertex credentials unavailable', {
      reason: credentialsError ?? 'unknown',
    });
    return null;
  }
  try {
    const token = await getToken();
    if (!token) {
      logger.error('Vertex returned an empty access token');
      return null;
    }
    return token;
  } catch (error) {
    logger.error('Vertex token request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Reset cached auth state. Testing only. */
export function resetVertexAuth(): void {
  tokenGetter = null;
  credentialsError = null;
}
