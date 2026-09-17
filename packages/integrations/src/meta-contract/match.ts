import {
  GRAPH_ENDPOINTS,
  type GraphEndpoint,
  type GraphHost,
  type GraphMethod,
} from './endpoints.js';

/** A Graph URL broken into the parts the registry matches on. */
export interface ParsedGraphUrl {
  host: GraphHost;
  /** API version segment, e.g. `v21.0`. Null when the URL carries none. */
  version: string | null;
  /** Path after the version prefix, leading slash included. `/act_1/ads`. */
  path: string;
  query: URLSearchParams;
}

const HOSTS: Record<string, GraphHost> = {
  'graph.facebook.com': 'facebook',
  'graph.instagram.com': 'instagram',
};

/** `v21.0`, `v3.2` — the Graph version segment. */
const VERSION_SEGMENT = /^v\d+\.\d+$/;

/**
 * True when this URL targets a Graph host at all.
 *
 * The fake uses this to decide whether a request is "mine" — everything else
 * (S3, CloudFront, Remotion, OpenAI, …) passes straight through untouched.
 */
export function isGraphUrl(url: string): boolean {
  try {
    return new URL(url).hostname in HOSTS;
  } catch {
    return false;
  }
}

/** Parse a Graph URL, or `null` if it isn't one. */
export function parseGraphUrl(url: string): ParsedGraphUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = HOSTS[parsed.hostname];
  if (!host) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  let version: string | null = null;
  if (segments.length > 0 && VERSION_SEGMENT.test(segments[0] as string)) {
    version = segments.shift() as string;
  }

  return {
    host,
    version,
    path: `/${segments.join('/')}`,
    query: parsed.searchParams,
  };
}

export interface EndpointMatch {
  endpoint: GraphEndpoint;
  parsed: ParsedGraphUrl;
}

/**
 * Resolve a request to a registry entry.
 *
 * FIRST MATCH WINS, in registry order. That ordering is load-bearing: the
 * generic `node.get` / `node.update` / `node.delete` matchers (`^/{id}$`) sit
 * last so specific shapes claim their requests first, and
 * `ads.listCampaignInsights` (`/act_x/insights`) precedes the generic
 * `ads.nodeInsights` (`/{id}/insights`) for the same reason.
 *
 * Returns `null` for a Graph URL with no matching entry — which the fake turns
 * into a hard failure naming the method and path, so a new call site is
 * impossible to miss.
 */
export function matchGraphRequest(
  url: string,
  method: string
): EndpointMatch | null {
  const parsed = parseGraphUrl(url);
  if (!parsed) return null;

  const wanted = method.toUpperCase() as GraphMethod;

  for (const endpoint of GRAPH_ENDPOINTS) {
    if (endpoint.method !== wanted) continue;
    if (endpoint.host !== parsed.host) continue;
    if (!endpoint.match.test(parsed.path)) continue;
    return { endpoint, parsed };
  }

  return null;
}

/**
 * A short, credential-free description of a request, for error messages and
 * recording labels: `POST /act_1/ads`.
 *
 * Never include the query string — Graph carries `access_token` and
 * `appsecret_proof` there.
 */
export function describeGraphRequest(url: string, method: string): string {
  const parsed = parseGraphUrl(url);
  return `${method.toUpperCase()} ${parsed?.path ?? url}`;
}
