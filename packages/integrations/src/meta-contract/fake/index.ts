import type { FetchInterceptor } from '@borradh-workspace/http';
import {
  describeGraphRequest,
  isGraphUrl,
  matchGraphRequest,
} from '../match.js';
import {
  type MagicBehaviour,
  detectMagicBehaviour,
  envelopeFor,
} from './magic-ids.js';
import { REQUEST_SCHEMAS } from './request-schemas.js';
import { RESPONDERS } from './responders.js';

/**
 * The E2E Meta contract FAKE.
 *
 * Installed at boot when `META_E2E_STUB=true` (preview / local CI hosts ONLY —
 * never production). Serves every Graph request from the declared contract so
 * the browser suite can drive ad publishes, social posts and chatbot delivery
 * without touching real Meta.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a Meta simulator. It models no ad-review state machine, no delivery, no
 * insights arithmetic. Behaviour that needs to vary is driven explicitly by
 * magic ids (see `magic-ids.ts`), the way Stripe's test cards work — not
 * inferred.
 *
 * THE TWO LOUD FAILURES
 * ---------------------
 * 1. **Unknown endpoint.** A Graph request with no registry entry THROWS. It
 *    never falls through to the network — a new call site must be declared, not
 *    silently escape to real Meta from a stubbed host.
 * 2. **Request-contract violation.** A payload that doesn't parse against the
 *    endpoint's `.strict()` schema THROWS, naming the offending key. This is
 *    the "someone added a parameter" detector, and it fires in seconds rather
 *    than as a confusing timeout ten minutes into an E2E run.
 *
 * Both surface as a rejected fetch, which is exactly how a real Meta outage
 * would surface — so the product's error handling is exercised, not bypassed.
 */

export class MetaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaContractError';
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Graph accepts JSON and urlencoded bodies. Normalise to a plain object so one
 * schema can validate either encoding.
 */
function parseBody(body: string | null): unknown {
  if (body == null || body === '') return {};
  try {
    return JSON.parse(body);
  } catch {
    if (!body.includes('=')) return {};
    return Object.fromEntries(new URLSearchParams(body));
  }
}

/**
 * Maximum bytes of a binary body we decode for inspection.
 *
 * The media-upload paths hand-build multipart bodies as `Buffer`s: a 4 MB video
 * chunk, or a whole image. We only ever need the multipart FIELD HEADERS, which
 * sit at the very front — decoding the entire payload to a string per chunk
 * would be pure waste.
 */
const BODY_INSPECT_BYTES = 2048;

/**
 * Best-effort text view of a request body.
 *
 * Returns the full string for string bodies (JSON, urlencoded). For BINARY
 * bodies — `Buffer` / typed arrays, which is what `uploadVideo` and
 * `uploadImage` send — returns a decoded PREFIX so callers can read multipart
 * field headers.
 *
 * Returning `null` here (as an earlier version did for anything non-string)
 * made every video upload look like a single-shot upload: the chunked
 * start/transfer/finish phases were invisible, so the fake answered `{ id }` to
 * a `start` and the upload loop had no `upload_session_id` to continue with.
 * Videos over 20 MB — the threshold for chunking — could not be stubbed at all.
 */
function bodyAsString(body: RequestInit['body']): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;

  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const bytes = new Uint8Array(
      view.buffer,
      view.byteOffset,
      Math.min(view.byteLength, BODY_INSPECT_BYTES)
    );
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder('utf-8', { fatal: false }).decode(
      new Uint8Array(body, 0, Math.min(body.byteLength, BODY_INSPECT_BYTES))
    );
  }

  return null;
}

/** A promise that never settles — the caller's timeout is what ends it. */
function neverResolves(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

function handleMagic(behaviour: MagicBehaviour): Response | null {
  if (behaviour === 'timeout') {
    // Deliberately unresolved. The seam races every interceptor against its
    // abort signal, so this surfaces as a real FetchTimeoutError.
    return null;
  }
  const envelope = envelopeFor(behaviour);
  if (!envelope) return null; // 'ad-disapproved' shapes the response instead.
  return jsonResponse(envelope.body, envelope.status);
}

/**
 * How much of Graph the fake claims.
 *
 * `all` — every declared endpoint. Unknown endpoints HARD FAIL: there is no
 *   real Meta to fall back to, so a new call site must be declared.
 *
 * `marketing` — the Marketing API ONLY (ad accounts, ad entities, lead forms).
 *   Everything else passes through to real Meta.
 *
 *   This exists because the rate limiter and the fake have the same shape.
 *   Error code 17 is a MARKETING API limit — it is ad publishes, run in
 *   parallel against one ad account, that trip it. Messenger's Send API and
 *   WhatsApp Cloud have separate, far more generous limits that a handful of
 *   test messages never approaches.
 *
 *   So faking the Marketing API removes the rate limiting, while inbound/
 *   outbound MESSAGING keeps hitting real Meta — which is the coverage worth
 *   protecting, because "the bot stopped replying" is a silent, high-blast-
 *   radius failure and the one Meta actually changes under us (see the
 *   100/2018048 sender-action incident).
 */
export type MetaFakeScope = 'all' | 'marketing';

/**
 * Node-id prefixes the fake mints. Used to decide whether a bare `/{id}`
 * operation belongs to us in `marketing` scope.
 *
 * `GET|POST|DELETE /{id}` is shared between ad entities (campaign, ad set, ad,
 * creative) and page/post objects, so the PATH cannot discriminate. The id can:
 * real Graph ids are numeric, and everything the fake mints is prefixed. So the
 * rule is simply "fake what the fake created" — anything else is a real object
 * and goes to real Meta.
 */
const FAKE_ID_PREFIXES = [
  'camp-',
  'adset-',
  'creative-',
  'ad-',
  'form-',
  'vid-',
  'ups-',
  'imghash-',
];

/**
 * Marketing endpoints whose path node is an ARBITRARY object, not `act_…`:
 * `/{campaignId}/ads`, `/{pageId}/leadgen_forms`, `/{campaignId}/copies`, …
 *
 * These get the same "fake what the fake created" rule as bare node ops. An
 * org's pre-existing REAL campaigns are still reachable through them, and
 * answering for a real campaign id out of an empty store would report it as
 * having no ads — worse than passing the request through.
 *
 * Deliberately NOT here: the page-scoped lead-form edges and `ads.nodeInsights`
 * carry a REAL page id, so a prefix rule would push them out to real Meta —
 * they stay faked exactly as they were before this set existed.
 */
const NODE_SCOPED_ADS_ENDPOINTS = new Set([
  'ads.listCampaignAds',
  'ads.listCampaignAdSets',
  'ads.duplicateCampaign',
  'ads.listFormLeads',
]);

/** Does this request belong to the Marketing API surface? */
function isMarketingRequest(endpointId: string, path: string): boolean {
  const nodeId = path.split('/').filter(Boolean)[0] ?? '';
  const isOurNode = FAKE_ID_PREFIXES.some((p) => nodeId.startsWith(p));

  // Node-scoped ads edges + bare node ops — ours only if we minted the id.
  if (NODE_SCOPED_ADS_ENDPOINTS.has(endpointId)) return isOurNode;
  if (endpointId.startsWith('node.')) return isOurNode;

  // Everything under an ad account.
  return endpointId.startsWith('ads.');
}

export interface MetaFakeOptions {
  /**
   * Called for every served request. Lets a host log what the fake handled —
   * useful when a spec fails and you want to see the Graph traffic it drove.
   */
  onRequest?: (endpointId: string, description: string) => void;
  /** Defaults to `all`. See {@link MetaFakeScope}. */
  scope?: MetaFakeScope;
}

export function createMetaFakeInterceptor(
  options: MetaFakeOptions = {}
): FetchInterceptor {
  const scope = options.scope ?? 'all';

  return async (url, init) => {
    // Not Graph → not ours. S3, CloudFront, Remotion, OpenAI, Stripe and
    // everything else go straight to the network untouched.
    if (!isGraphUrl(url)) return null;

    const method = (init.method ?? 'GET').toUpperCase();
    const description = describeGraphRequest(url, method);
    const rawBody = bodyAsString(init.body);

    const magic = detectMagicBehaviour(url, rawBody);
    if (magic === 'timeout') return neverResolves();
    if (magic) {
      const response = handleMagic(magic);
      if (response) {
        options.onRequest?.('magic', `${description} → ${magic}`);
        return response;
      }
    }

    const matched = matchGraphRequest(url, method);
    if (!matched) {
      // In `marketing` scope real Meta IS reachable, so an undeclared endpoint
      // passes through rather than failing. Failing here would break a chatbot
      // spec because some unrelated OAuth call was never declared — the fake
      // must not become a gate on endpoints it does not claim.
      //
      // In `all` scope there is no fallback, so an undeclared endpoint is a
      // hard error: silently reaching real Meta from a fully-stubbed host is
      // exactly what this module exists to prevent.
      if (scope !== 'all') {
        options.onRequest?.('passthrough', `${description} (undeclared)`);
        return null;
      }
      throw new MetaContractError(
        [
          `Unknown Graph endpoint: ${description}`,
          'The Meta contract fake refuses to guess, and will not fall through to real Meta from a stubbed host.',
          'Fix: declare it in packages/integrations/src/meta-contract/endpoints.ts, then add its schemas and a responder.',
        ].join('\n')
      );
    }

    const { endpoint, parsed } = matched;

    // Declared, but out of scope → real Meta. This is the messaging path under
    // `marketing` scope: Messenger sends, WhatsApp, page publishing and IG all
    // stay real, because they are not what rate-limits us and they are the
    // coverage most worth keeping honest.
    if (
      scope === 'marketing' &&
      !isMarketingRequest(endpoint.id, parsed.path)
    ) {
      options.onRequest?.('passthrough', `${description} → real Meta`);
      return null;
    }

    // Validate the outgoing request against the strict contract.
    const schema = REQUEST_SCHEMAS[endpoint.id];
    if (schema) {
      const result = schema.safeParse(parseBody(rawBody));
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n');
        throw new MetaContractError(
          [
            `Request contract violation on ${endpoint.id} (${description}):`,
            issues,
            '',
            'The payload our code built does not match the declared contract. If this is an intentional change, update the schema in packages/integrations/src/meta-contract/schemas.ts — do not loosen it to make the error go away.',
          ].join('\n')
        );
      }
    }

    const responder = RESPONDERS[endpoint.id];
    if (!responder) {
      throw new MetaContractError(
        `No responder for endpoint ${endpoint.id} (${description}). Add one in meta-contract/fake/responders.ts.`
      );
    }

    options.onRequest?.(endpoint.id, description);

    // Responders that touch the object store are async — it is Redis-backed in
    // any multi-process host (see `store.ts`).
    return jsonResponse(
      await responder({
        parsed,
        body: rawBody,
        disapproved: magic === 'ad-disapproved',
      })
    );
  };
}

export { MAGIC_IDS } from './magic-ids.js';
