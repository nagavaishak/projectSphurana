// The synthesized Sentry-protocol event is the risky part of decoupling
// BetterStack from Sentry: if the shape is wrong, BetterStack accepts the POST
// and drops the event, so nothing fails and the errors are simply gone. These
// assert the fields BetterStack keys on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
vi.stubGlobal('fetch', fetchMock);

/** Re-import with a fresh module registry so the DSN cache re-reads env. */
const load = async () => {
  vi.resetModules();
  return import('./betterstack-forwarder.js');
};

const lastBody = () => {
  const call = fetchMock.mock.calls.at(-1) as
    | [string, { body: string; headers: Record<string, string> }]
    | undefined;
  if (!call) throw new Error('fetch was not called');
  return {
    url: call[0],
    headers: call[1].headers,
    body: JSON.parse(call[1].body),
  };
};

describe('forwardErrorToBetterStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.BETTERSTACK_ERROR_DSN =
      'https://pubkey@in.betterstack.com/4242';
  });

  it('no-ops without a DSN rather than throwing', async () => {
    process.env.BETTERSTACK_ERROR_DSN = '';
    const { forwardErrorToBetterStack } = await load();

    expect(() => forwardErrorToBetterStack(new Error('boom'))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the store endpoint with Sentry auth', async () => {
    const { forwardErrorToBetterStack } = await load();
    forwardErrorToBetterStack(new Error('boom'));

    const { url, headers } = lastBody();
    expect(url).toBe('https://in.betterstack.com/api/4242/store/');
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=pubkey');
    expect(headers['X-Sentry-Auth']).toContain('sentry_version=7');
  });

  it('builds a protocol-valid event', async () => {
    const { forwardErrorToBetterStack } = await load();
    forwardErrorToBetterStack(new Error('boom'), {
      operation: 'billing.checkout',
      feature: 'billing',
      tags: { source: 'test' },
      extra: { planId: 'pro' },
      user: { id: 'u1' },
    });

    const { body } = lastBody();
    // 32 lowercase hex, no dashes — the protocol rejects a plain UUID.
    expect(body.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(body.exception.values[0]).toMatchObject({
      type: 'Error',
      value: 'boom',
    });
    expect(body.level).toBe('error');
    expect(body.logger).toBe('billing.checkout');
    expect(body.tags).toMatchObject({
      feature: 'billing',
      operation: 'billing.checkout',
      source: 'test',
    });
    expect(body.extra.planId).toBe('pro');
    expect(body.extra.stack).toContain('boom');
    expect(body.user).toEqual({ id: 'u1' });
  });

  it('reports the ROOT cause, so all three sinks group alike', async () => {
    // logError reports `cause ?? err` to Sentry and PostHog. If this reported
    // the wrapper instead, BetterStack would group the same failure under a
    // different title and cross-referencing an incident would break.
    const { forwardErrorToBetterStack } = await load();
    const root = new Error('duplicate key value violates unique constraint');
    root.name = 'PostgresError';
    forwardErrorToBetterStack(
      new Error('Failed to create practitioner', { cause: root })
    );

    const { body } = lastBody();
    expect(body.exception.values[0]).toMatchObject({
      type: 'PostgresError',
      value: 'duplicate key value violates unique constraint',
    });
    // The wrapper is not lost, just demoted to context.
    expect(body.extra.wrappedBy).toBe('Failed to create practitioner');
  });

  it('tags the deploy environment the same way PostHog does', async () => {
    // The prod-vs-preview split is queried on this field in both systems; a
    // divergence here files production errors under the wrong environment.
    process.env.BULLMQ_KEY_PREFIX = 'pr-123';
    const preview = await load();
    preview.forwardErrorToBetterStack(new Error('boom'));
    expect(lastBody().body.environment).toBe('preview');

    process.env.BULLMQ_KEY_PREFIX = '';
    process.env.APP_ENV = 'production';
    const prod = await load();
    prod.forwardErrorToBetterStack(new Error('boom'));
    expect(lastBody().body.environment).toBe('production');
  });

  it('never throws when fetch rejects', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new Error('network'))
    );
    const { forwardErrorToBetterStack } = await load();

    expect(() => forwardErrorToBetterStack(new Error('boom'))).not.toThrow();
  });
});
