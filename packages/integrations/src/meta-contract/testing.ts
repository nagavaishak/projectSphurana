import { REQUEST_SCHEMAS } from './fake/request-schemas.js';
import { matchGraphRequest } from './match.js';

/**
 * Helpers for REQUEST-CONTRACT tests (Tier 2).
 *
 * The point of routing these assertions through the SAME registry the fake
 * enforces is that Tier 1 and Tier 2 cannot disagree. If the contract tests
 * validated against their own copy of the shapes, the fake could accept a
 * payload the tests reject (or vice-versa) and we'd be back to two sources of
 * truth pretending to be one.
 *
 * Usage: stub `fetch`, drive the real service method, then assert the captured
 * payload against the contract.
 *
 * NO TEST-FRAMEWORK IMPORT. This file is compiled into `dist/` (the lib build
 * excludes only `*.test.ts` / `*.spec.ts`), so importing `vitest` here would
 * ship a devDependency import into the production bundle — the kind of thing
 * that surfaces as a module-not-found in a distroless image. Assertions throw
 * plain `Error`s instead; vitest reports those with the full message anyway.
 */

export interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  /** Registry endpoint id the request resolved to. */
  endpointId: string | null;
}

/** Parse a captured body — Graph takes JSON and urlencoded. */
function parseBody(body: unknown): unknown {
  if (typeof body !== 'string' || body === '') return {};
  try {
    return JSON.parse(body);
  } catch {
    if (!body.includes('=')) return {};
    return Object.fromEntries(new URLSearchParams(body));
  }
}

/**
 * Read the nth call off a `vi.fn()` fetch mock as a structured request.
 *
 * Works for both call shapes in this codebase: `apiRequest` passes
 * `(url, init)`, and the features-level publish paths do the same via
 * `metaFetch`.
 */
export function captureRequest(
  fetchMock: { mock: { calls: unknown[][] } },
  index = 0
): CapturedRequest {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(
      `No fetch call at index ${index} — the service made ${fetchMock.mock.calls.length} call(s).`
    );
  }

  const [url, init] = call as [string, RequestInit | undefined];
  const method = (init?.method ?? 'GET').toUpperCase();

  return {
    url,
    method,
    body: parseBody(init?.body),
    endpointId: matchGraphRequest(url, method)?.endpoint.id ?? null,
  };
}

/** Every captured request, in call order. */
export function captureAllRequests(fetchMock: {
  mock: { calls: unknown[][] };
}): CapturedRequest[] {
  return fetchMock.mock.calls.map((_, i) => captureRequest(fetchMock, i));
}

/**
 * Assert that a captured request resolves to `endpointId` AND that its payload
 * satisfies that endpoint's strict request schema.
 *
 * Failure here means one of two things, both worth knowing:
 *   - the payload gained/lost a field → update `schemas.ts` deliberately
 *   - the URL shape changed → update `endpoints.ts`
 *
 * Returns the parsed payload so the caller can make specific assertions on top
 * (the variant matrix: video vs image, CDN vs S3, destination type).
 */
export function expectMatchesContract(
  captured: CapturedRequest,
  endpointId: string
): Record<string, unknown> {
  if (captured.endpointId !== endpointId) {
    throw new Error(
      `Request ${captured.method} ${captured.url} resolved to ${
        captured.endpointId ?? 'NO ENDPOINT'
      }, expected ${endpointId}. If the URL shape changed, update endpoints.ts.`
    );
  }

  const schema = REQUEST_SCHEMAS[endpointId];
  if (!schema) {
    throw new Error(
      `No request schema registered for ${endpointId}. Every WRITE endpoint needs one — without it the fake accepts any payload and the "added a parameter" detection silently disappears.`
    );
  }

  const result = schema.safeParse(captured.body);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Payload for ${endpointId} does not satisfy the declared contract:\n${issues}\n\nReceived:\n${JSON.stringify(
        captured.body,
        null,
        2
      )}`
    );
  }

  return captured.body as Record<string, unknown>;
}

/** A canned OK response, so a stubbed service call completes normally. */
export function okResponse(
  body: unknown = { id: 'contract-test-id' }
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
