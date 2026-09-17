/**
 * The HTTP layer is injected, so no test here can reach api.vercel.com even if
 * the environment happens to carry a real token.
 *
 * The idempotency cases (`add` on an existing domain, `remove` on a missing
 * one) are the ones that matter most: BullMQ retries these calls, and an
 * adapter that reports "already exists" as a failure strands a tenant's domain
 * in `error` on a perfectly healthy second attempt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainProviderErrorCodes } from './domain-provider.js';
import {
  VERCEL_APEX_A_RECORD,
  VERCEL_WWW_CNAME_TARGET,
  VercelDomainProvider,
} from './vercel-domain-provider.js';

const TOKEN = 'test-token-never-real';

/** Build a fetch double that replays a queue of scripted responses. */
const scriptedFetch = (
  responses: { status: number; body?: unknown }[]
): { impl: typeof fetch; calls: { url: string; init?: RequestInit }[] } => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = next?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        next?.body === undefined ? '' : JSON.stringify(next.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

const build = (responses: { status: number; body?: unknown }[]) => {
  const { impl, calls } = scriptedFetch(responses);
  const provider = new VercelDomainProvider({
    token: TOKEN,
    projectId: 'prj_test',
    teamId: 'team_test',
    fetchImpl: impl,
  });
  return { provider, calls };
};

describe('VercelDomainProvider.add', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches a new apex domain and returns the routing + challenge records', async () => {
    const { provider, calls } = build([
      {
        status: 200,
        body: {
          name: 'salon.com',
          apexName: 'salon.com',
          verified: false,
          verification: [
            {
              type: 'TXT',
              domain: '_vercel.salon.com',
              value: 'vc-domain-verify=abc',
              reason: 'pending_domain_verification',
            },
          ],
        },
      },
    ]);

    const result = await provider.add('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alreadyExisted).toBe(false);
    expect(result.data.state).toBe('pending_dns');
    expect(result.data.records).toEqual([
      { type: 'A', name: '@', value: VERCEL_APEX_A_RECORD, purpose: 'routing' },
      {
        type: 'TXT',
        name: '_vercel.salon.com',
        value: 'vc-domain-verify=abc',
        purpose: 'challenge',
      },
    ]);

    expect(calls[0]?.url).toBe(
      'https://api.vercel.com/v10/projects/prj_test/domains?teamId=team_test'
    );
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('recommends a CNAME, not an A record, for a subdomain', async () => {
    const { provider } = build([
      { status: 200, body: { name: 'www.salon.com', verified: false } },
    ]);

    const result = await provider.add('www.salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.records).toEqual([
      {
        type: 'CNAME',
        name: 'www',
        value: VERCEL_WWW_CNAME_TARGET,
        purpose: 'routing',
      },
    ]);
  });

  // ── IDEMPOTENCY ──────────────────────────────────────────────────
  it('is idempotent: a 409 for a domain WE already hold is a success', async () => {
    const { provider, calls } = build([
      {
        status: 409,
        body: { error: { code: 'domain_already_in_use', message: 'In use' } },
      },
      { status: 200, body: { name: 'salon.com', verified: true } },
    ]);

    const result = await provider.add('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alreadyExisted).toBe(true);
    // The follow-up GET is what distinguishes "our retry" from "someone else's
    // domain" — without it a retry would look like a conflict.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init?.method).toBe('GET');
  });

  it('reports a CONFLICT when the 409 belongs to another account', async () => {
    const { provider } = build([
      {
        status: 409,
        body: { error: { code: 'domain_already_in_use', message: 'In use' } },
      },
      { status: 404, body: { error: { code: 'not_found' } } },
    ]);

    const result = await provider.add('salon.com');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(DomainProviderErrorCodes.DOMAIN_CLAIMED);
  });

  it('maps 400 to INVALID_DOMAIN, 429 to RATE_LIMITED, 403 to NOT_CONFIGURED', async () => {
    for (const [status, code] of [
      [400, DomainProviderErrorCodes.INVALID_DOMAIN],
      [429, DomainProviderErrorCodes.RATE_LIMITED],
      [403, DomainProviderErrorCodes.NOT_CONFIGURED],
      [500, DomainProviderErrorCodes.PROVIDER_ERROR],
    ] as const) {
      const { provider } = build([
        { status, body: { error: { code: 'x', message: 'nope' } } },
      ]);
      const result = await provider.add('salon.com');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe(code);
    }
  });

  it('never leaks the token into an error', async () => {
    const { provider } = build([
      { status: 500, body: { error: { code: 'boom', message: 'upstream' } } },
    ]);

    const result = await provider.add('salon.com');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error)).not.toContain(TOKEN);
    expect(JSON.stringify(result.error)).not.toContain('Authorization');
  });

  it('reports NOT_CONFIGURED without calling out when credentials are absent', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200 }]);
    const provider = new VercelDomainProvider({
      token: undefined,
      projectId: undefined,
      fetchImpl: impl,
    });

    const result = await provider.add('salon.com');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(DomainProviderErrorCodes.NOT_CONFIGURED);
    expect(calls).toHaveLength(0);
  });
});

describe('VercelDomainProvider.verify', () => {
  it('stays pending_dns while the ownership challenge is outstanding', async () => {
    const { provider, calls } = build([
      {
        status: 200,
        body: {
          name: 'salon.com',
          verified: false,
          verification: [
            { type: 'TXT', domain: '_vercel.salon.com', value: 'vc-1' },
          ],
        },
      },
    ]);

    const result = await provider.verify('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state).toBe('pending_dns');
    expect(result.data.records).toContainEqual({
      type: 'TXT',
      name: '_vercel.salon.com',
      value: 'vc-1',
      purpose: 'challenge',
    });
    // No /config call — there is nothing to check until ownership lands.
    expect(calls).toHaveLength(1);
  });

  it('is verifying, NOT active, when ownership is proven but routing is misconfigured', async () => {
    const { provider } = build([
      { status: 200, body: { name: 'salon.com', verified: true } },
      { status: 200, body: { misconfigured: true } },
    ]);

    const result = await provider.verify('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Flipping active here would serve the tenant's site on a hostname whose
    // A record still points somewhere else.
    expect(result.data.state).toBe('verifying');
  });

  it('is active once verified and correctly configured', async () => {
    const { provider } = build([
      { status: 200, body: { name: 'salon.com', verified: true } },
      { status: 200, body: { misconfigured: false, configuredBy: 'A' } },
    ]);

    const result = await provider.verify('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state).toBe('active');
    expect(result.data.records).toEqual([]);
  });

  it('degrades a failed /config read to verifying rather than error', async () => {
    const { provider } = build([
      { status: 200, body: { name: 'salon.com', verified: true } },
      { status: 500, body: { error: { code: 'boom' } } },
    ]);

    const result = await provider.verify('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state).toBe('verifying');
  });

  it('returns NOT_FOUND when the domain is not attached', async () => {
    const { provider } = build([
      { status: 404, body: { error: { code: 'not_found' } } },
    ]);

    const result = await provider.verify('salon.com');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(DomainProviderErrorCodes.NOT_FOUND);
  });
});

describe('VercelDomainProvider.remove', () => {
  it('detaches a domain', async () => {
    const { provider, calls } = build([{ status: 200, body: {} }]);

    const result = await provider.remove('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alreadyRemoved).toBe(false);
    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(
      'https://api.vercel.com/v9/projects/prj_test/domains/salon.com?teamId=team_test'
    );
  });

  // ── IDEMPOTENCY ──────────────────────────────────────────────────
  it('is idempotent: removing an already-gone domain is a success', async () => {
    const { provider } = build([
      { status: 404, body: { error: { code: 'not_found' } } },
    ]);

    const result = await provider.remove('salon.com');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.alreadyRemoved).toBe(true);
  });

  it('still fails on a real provider error', async () => {
    const { provider } = build([
      { status: 500, body: { error: { code: 'boom', message: 'upstream' } } },
    ]);

    const result = await provider.remove('salon.com');
    expect(result.success).toBe(false);
  });
});
