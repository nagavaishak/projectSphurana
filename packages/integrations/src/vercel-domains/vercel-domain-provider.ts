/**
 * `DomainProvider` over the Vercel Projects/Domains API.
 *
 * THE ONLY FILE IN THE WORKSPACE THAT KNOWS WE ARE ON VERCEL. Everything above
 * it — the services, the polling job, the database — speaks the neutral shapes
 * in `domain-provider.ts`. Swapping to Cloudflare for SaaS means writing a
 * sibling of this file and changing one factory call.
 *
 * Endpoints used:
 *   add     POST   /v10/projects/{projectId}/domains
 *   verify  GET    /v9/projects/{projectId}/domains/{domain}
 *           GET    /v9/projects/{projectId}/domains/{domain}/config
 *   remove  DELETE /v9/projects/{projectId}/domains/{domain}
 *
 * ## Idempotency
 *
 * `add` treats Vercel's 409 as a QUESTION, not an answer: `domain_already_in_use`
 * means "somebody has it", and only a follow-up GET says whether that somebody
 * is us. Ours → success with `alreadyExisted: true`. Someone else's →
 * `DOMAIN_CLAIMED`, which the service surfaces as a CONFLICT rather than a 500.
 * `remove` treats 404 as success, because a retry after a successful delete is
 * the ordinary second call.
 *
 * ## The token
 *
 * Read once, from `packages/env`, and never leaves this file. Error paths carry
 * the HTTP status and Vercel's own `error.code`/`error.message` — never the
 * request init, never the headers, never the URL's credentials. An error object
 * that includes the headers is a credential leak into Sentry, and this comment
 * exists because that is an easy line to add during debugging.
 */

import { vercelEnv } from '@borradh-workspace/env/vercel';
import { fetchWithTimeout } from '@borradh-workspace/http';
import {
  type AddedDomain,
  type DomainDnsRecord,
  type DomainProvider,
  DomainProviderErrorCodes,
  type DomainProviderResult,
  type DomainState,
  type DomainStatus,
  type RemovedDomain,
  providerErr,
  providerOk,
} from './domain-provider.js';

const VERCEL_API_BASE = 'https://api.vercel.com';

/** Vercel's shared apex/CNAME targets. Public values, safe to hand a tenant. */
export const VERCEL_APEX_A_RECORD = '76.76.21.21';
export const VERCEL_WWW_CNAME_TARGET = 'cname.vercel-dns.com';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Minimal shape of the Vercel project-domain object we actually read. */
interface VercelProjectDomain {
  name?: string;
  apexName?: string;
  verified?: boolean;
  verification?: {
    type?: string;
    domain?: string;
    value?: string;
    reason?: string;
  }[];
}

/** Minimal shape of `/config`. */
interface VercelDomainConfig {
  misconfigured?: boolean;
  configuredBy?: string | null;
  recommendedIPv4?: { value?: string[] }[];
  recommendedCNAME?: { value?: string }[];
}

interface VercelErrorBody {
  error?: { code?: string; message?: string };
}

/** A parsed HTTP outcome. `body` is `null` when there was nothing to parse. */
interface VercelResponse<T> {
  ok: boolean;
  status: number;
  body: T | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface VercelDomainProviderOptions {
  /** Defaults to `VERCEL_API_TOKEN`. SECRET — never logged. */
  token?: string;
  /** Defaults to `VERCEL_PROJECT_ID`. */
  projectId?: string;
  /** Defaults to `VERCEL_TEAM_ID`. Omitted for personal projects. */
  teamId?: string;
  timeoutMs?: number;
  /** Injection seam for tests. Production uses the timeout-bounded fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Map Vercel's `verification` challenges onto neutral records. Vercel names the
 * TXT record by its FULL domain (`_vercel.example.com`); we keep that verbatim
 * because a tenant pasting it into a registrar that expects a relative name will
 * be told so by the registrar, whereas a wrongly-relativised name silently
 * creates `_vercel.example.com.example.com`.
 */
const toChallengeRecords = (domain: VercelProjectDomain): DomainDnsRecord[] =>
  (domain.verification ?? [])
    .filter((v) => v.type && v.value)
    .map((v) => ({
      type: String(v.type).toUpperCase(),
      name: v.domain ?? '@',
      value: String(v.value),
      purpose: 'challenge' as const,
    }));

/**
 * The routing records a tenant must create regardless of the challenge: an A
 * record on the apex, a CNAME on any subdomain. Vercel only *recommends* these
 * through `/config`, and only once it can see the zone — so we compute them
 * from the constants instead of waiting for the API to volunteer them.
 */
export const vercelRoutingRecords = (domain: string): DomainDnsRecord[] => {
  const labels = domain.split('.');
  const isSubdomain = labels.length > 2;
  if (isSubdomain) {
    return [
      {
        type: 'CNAME',
        name: labels[0] as string,
        value: VERCEL_WWW_CNAME_TARGET,
        purpose: 'routing',
      },
    ];
  }
  return [
    { type: 'A', name: '@', value: VERCEL_APEX_A_RECORD, purpose: 'routing' },
  ];
};

export class VercelDomainProvider implements DomainProvider {
  private readonly token: string | undefined;
  private readonly projectId: string | undefined;
  private readonly teamId: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VercelDomainProviderOptions = {}) {
    this.token = options.token ?? vercelEnv.VERCEL_API_TOKEN;
    this.projectId = options.projectId ?? vercelEnv.VERCEL_PROJECT_ID;
    this.teamId = options.teamId ?? vercelEnv.VERCEL_TEAM_ID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) =>
        fetchWithTimeout(input as string, {
          ...init,
          timeoutMs: this.timeoutMs,
        }));
  }

  /** True when the adapter has everything it needs to talk to Vercel. */
  isConfigured(): boolean {
    return Boolean(this.token && this.projectId);
  }

  // ── HTTP ─────────────────────────────────────────────────────────

  private url(path: string): string {
    const qs = this.teamId ? `?teamId=${encodeURIComponent(this.teamId)}` : '';
    return `${VERCEL_API_BASE}${path}${qs}`;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<VercelResponse<T>> {
    const response = await this.fetchImpl(this.url(path), {
      method,
      headers: {
        // The one place this value is used. It is never returned, logged, or
        // put in an error — see the file header.
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body (an HTML error page from an edge) is not worth failing
      // twice over; the status code still carries the outcome.
      parsed = null;
    }

    const errorBody = parsed as VercelErrorBody | null;
    return {
      ok: response.ok,
      status: response.status,
      body: response.ok ? (parsed as T | null) : null,
      errorCode: errorBody?.error?.code ?? null,
      errorMessage: errorBody?.error?.message ?? null,
    };
  }

  /**
   * Turn a failed call into a port error. Deliberately narrow: status, Vercel's
   * own code, Vercel's own message. Nothing from the request.
   */
  private fail(
    operation: string,
    response: VercelResponse<unknown>
  ): DomainProviderResult<never> {
    const code =
      response.status === 429
        ? DomainProviderErrorCodes.RATE_LIMITED
        : response.status === 401 || response.status === 403
          ? DomainProviderErrorCodes.NOT_CONFIGURED
          : response.status === 400
            ? DomainProviderErrorCodes.INVALID_DOMAIN
            : DomainProviderErrorCodes.PROVIDER_ERROR;

    return providerErr(
      code,
      response.errorMessage ?? `Domain ${operation} failed`,
      {
        status: response.status,
        ...(response.errorCode ? { providerCode: response.errorCode } : {}),
      }
    );
  }

  private notConfigured(): DomainProviderResult<never> {
    return providerErr(
      DomainProviderErrorCodes.NOT_CONFIGURED,
      'Custom domains are not configured on this deployment'
    );
  }

  private domainPath(domain: string, suffix = ''): string {
    return `/v9/projects/${encodeURIComponent(
      this.projectId as string
    )}/domains/${encodeURIComponent(domain)}${suffix}`;
  }

  // ── Port ─────────────────────────────────────────────────────────

  /**
   * Attach a domain. Idempotent — see the file header.
   */
  async add(domain: string): Promise<DomainProviderResult<AddedDomain>> {
    if (!this.isConfigured()) return this.notConfigured();

    const response = await this.call<VercelProjectDomain>(
      'POST',
      `/v10/projects/${encodeURIComponent(this.projectId as string)}/domains`,
      { name: domain }
    );

    if (response.ok && response.body) {
      return providerOk(this.toAdded(domain, response.body, false));
    }

    // 409 — somebody has it. Only a GET says whether that somebody is us, and
    // the difference is "retry succeeded" versus "a tenant typed a domain that
    // belongs to another account".
    if (response.status === 409) {
      const existing = await this.call<VercelProjectDomain>(
        'GET',
        this.domainPath(domain)
      );
      if (existing.ok && existing.body) {
        return providerOk(this.toAdded(domain, existing.body, true));
      }
      return providerErr(
        DomainProviderErrorCodes.DOMAIN_CLAIMED,
        'That domain is already attached to another account',
        { status: response.status }
      );
    }

    return this.fail('add', response);
  }

  private toAdded(
    domain: string,
    body: VercelProjectDomain,
    alreadyExisted: boolean
  ): AddedDomain {
    const challenges = toChallengeRecords(body);
    return {
      domain: body.name ?? domain,
      alreadyExisted,
      records: [...vercelRoutingRecords(body.name ?? domain), ...challenges],
      providerRef: body.name ?? domain,
      state: body.verified ? 'verifying' : 'pending_dns',
    };
  }

  /**
   * Poll ownership + DNS configuration. No side effects.
   *
   * TWO calls, because Vercel splits the two halves of "is this live?":
   * `verified` (we own it — the TXT challenge, or nameserver delegation) lives
   * on the domain object, and `misconfigured` (traffic actually reaches us —
   * the A/CNAME record) lives on `/config`. A domain can be verified and still
   * misconfigured, which is exactly the state a tenant sits in after adding the
   * TXT record but before adding the A record, and reporting it as `active`
   * would flip us live on a hostname that serves nothing.
   */
  async verify(domain: string): Promise<DomainProviderResult<DomainStatus>> {
    if (!this.isConfigured()) return this.notConfigured();

    const record = await this.call<VercelProjectDomain>(
      'GET',
      this.domainPath(domain)
    );

    if (!record.ok) {
      if (record.status === 404) {
        return providerErr(
          DomainProviderErrorCodes.NOT_FOUND,
          'Domain is not attached to this project',
          { status: 404 }
        );
      }
      return this.fail('verify', record);
    }

    const body = record.body ?? {};
    const challenges = toChallengeRecords(body);

    if (!body.verified) {
      return providerOk({
        domain,
        state: 'pending_dns' as DomainState,
        records: [...vercelRoutingRecords(domain), ...challenges],
        providerRef: body.name ?? domain,
        message: 'Waiting for the ownership record to appear in DNS',
      });
    }

    const config = await this.call<VercelDomainConfig>(
      'GET',
      this.domainPath(domain, '/config')
    );

    // A failed /config on an otherwise-verified domain is not an error state
    // for the DOMAIN — it is a transient read. Report `verifying` so the poller
    // comes back rather than marking a tenant's domain broken.
    if (!config.ok) {
      return providerOk({
        domain,
        state: 'verifying' as DomainState,
        records: vercelRoutingRecords(domain),
        providerRef: body.name ?? domain,
        message: 'Ownership confirmed; checking DNS routing',
      });
    }

    if (config.body?.misconfigured) {
      return providerOk({
        domain,
        state: 'verifying' as DomainState,
        records: vercelRoutingRecords(domain),
        providerRef: body.name ?? domain,
        message: 'Ownership confirmed; waiting for the routing record',
      });
    }

    return providerOk({
      domain,
      state: 'active' as DomainState,
      records: [],
      providerRef: body.name ?? domain,
    });
  }

  /**
   * Detach a domain. Idempotent — 404 means a previous attempt already
   * succeeded, which is the ordinary outcome of a BullMQ retry.
   */
  async remove(domain: string): Promise<DomainProviderResult<RemovedDomain>> {
    if (!this.isConfigured()) return this.notConfigured();

    const response = await this.call<unknown>(
      'DELETE',
      this.domainPath(domain)
    );

    if (response.ok) return providerOk({ domain, alreadyRemoved: false });
    if (response.status === 404) {
      return providerOk({ domain, alreadyRemoved: true });
    }

    return this.fail('remove', response);
  }
}

/** Factory, so call sites never construct provider-specific options inline. */
export const createVercelDomainProvider = (
  options: VercelDomainProviderOptions = {}
): VercelDomainProvider => new VercelDomainProvider(options);
