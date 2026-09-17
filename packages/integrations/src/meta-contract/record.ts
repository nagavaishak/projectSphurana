import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FetchInterceptor } from '@borradh-workspace/http';
import { redactUrlSecrets } from '@borradh-workspace/http';
import {
  describeGraphRequest,
  isGraphUrl,
  matchGraphRequest,
} from './match.js';

/**
 * Graph traffic RECORDER.
 *
 * Enabled with `META_CONTRACT_RECORD=1`. Passes every request through to real
 * Meta and captures what crossed the wire, so the contract schemas can be
 * written FROM REALITY rather than from the docs or from memory.
 *
 * This is the mechanism behind the project's guiding rule:
 *
 *     record what you don't control, declare what you do
 *
 * Response shapes are a fact about Meta — we discover them here. Request shapes
 * are a fact about our own code — those are declared in the request schemas.
 *
 * Intended use: run the connected E2E suite against real Meta with this on
 * (nightly, or `workflow_dispatch` in PR mode), download the artifact, and
 * write/reconcile the response schemas against it.
 *
 * SECRET HYGIENE — READ BEFORE CHANGING
 * -------------------------------------
 * Graph carries credentials IN THE QUERY STRING (`access_token`,
 * `appsecret_proof`) and sometimes in bodies. Everything is scrubbed AT WRITE
 * TIME, never "later" — a recording that hits disk unscrubbed is a leaked
 * credential, and these files are meant to be committed. If you add a field to
 * the record, scrub it in the same commit.
 */

/** Query/body keys whose values are credentials and must never be written. */
const SECRET_KEYS = [
  'access_token',
  'appsecret_proof',
  'client_secret',
  'code',
  'input_token',
];

const REDACTED = 'REDACTED';

export interface GraphRecording {
  /** Registry endpoint id, or `unmatched` — the latter is a finding, not noise. */
  endpointId: string;
  method: string;
  /** Path only, no query — the query is credential-bearing. */
  path: string;
  /** Query params with secrets removed, so `fields` etc. survive for schema work. */
  query: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
}

/** Scrub a parsed JSON-ish value of any credential-shaped keys, recursively. */
function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.includes(k) ? REDACTED : scrubValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Parse and scrub a request body. Graph takes both JSON and
 * `application/x-www-form-urlencoded` (the page-publish paths use the latter),
 * so handle both and fall back to a marker rather than writing raw bytes.
 */
function scrubRequestBody(body: RequestInit['body']): unknown {
  if (body == null) return null;
  if (typeof body !== 'string') return '[non-string body]';

  try {
    return scrubValue(JSON.parse(body));
  } catch {
    // Not JSON — try urlencoded.
    if (!body.includes('=')) return '[unparsed body]';
    const params = new URLSearchParams(body);
    const out: Record<string, string> = {};
    for (const [k, v] of params) {
      out[k] = SECRET_KEYS.includes(k) ? REDACTED : v;
    }
    return out;
  }
}

function scrubQuery(query: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of query) {
    out[k] = SECRET_KEYS.includes(k) ? REDACTED : v;
  }
  return out;
}

/** Build the recording for one exchange. Exported for direct unit testing. */
export function buildRecording(
  url: string,
  init: RequestInit,
  status: number,
  responseBody: unknown
): GraphRecording {
  const method = (init.method ?? 'GET').toUpperCase();
  const matched = matchGraphRequest(url, method);

  return {
    endpointId: matched?.endpoint.id ?? 'unmatched',
    method,
    path: matched?.parsed.path ?? redactUrlSecrets(url),
    query: matched ? scrubQuery(matched.parsed.query) : {},
    requestBody: scrubRequestBody(init.body),
    status,
    responseBody: scrubValue(responseBody),
  };
}

export interface RecordingOptions {
  /** Directory for `graph-recordings.ndjson`. */
  dir: string;
  /** Override the sink (tests). Defaults to appending NDJSON to `dir`. */
  write?: (recording: GraphRecording) => void;
}

function defaultWriter(dir: string): (recording: GraphRecording) => void {
  const file = path.join(dir, 'graph-recordings.ndjson');
  let ready = false;

  return (recording) => {
    if (!ready) {
      mkdirSync(dir, { recursive: true });
      ready = true;
    }
    appendFileSync(file, `${JSON.stringify(recording)}\n`, 'utf8');
  };
}

/**
 * Build the recording interceptor.
 *
 * Non-Graph URLs return `null` (straight through, never observed). Graph URLs
 * are fetched for real, cloned for capture, and the ORIGINAL response is handed
 * back untouched so product behaviour is identical with recording on or off.
 *
 * Recording must never break the run it observes: a capture failure is
 * swallowed with a warning. Losing a sample is annoying; failing a real ad
 * publish because the disk was full is not acceptable.
 */
export function createRecordingInterceptor(
  options: RecordingOptions
): FetchInterceptor {
  const write = options.write ?? defaultWriter(options.dir);

  return async (url, init) => {
    if (!isGraphUrl(url)) return null;

    const response = await fetch(url, init);

    try {
      const clone = response.clone();
      const text = await clone.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text.slice(0, 500);
      }
      write(buildRecording(url, init, response.status, parsed));
    } catch (error) {
      console.warn(
        `[meta-contract] failed to record ${describeGraphRequest(
          url,
          init.method ?? 'GET'
        )}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return response;
  };
}
