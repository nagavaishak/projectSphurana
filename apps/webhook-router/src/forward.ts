import {
  type Logger,
  logError,
  logWarning,
} from '@borradh-workspace/observability';
import type { Subscriber } from './store.js';

interface ForwardArgs {
  subscriber: Subscriber;
  destinationPath: string; // e.g. '/webhooks/stripe' (no leading host)
  method: string;
  headers: Headers;
  body: ArrayBuffer;
  timeoutMs: number;
  logger: Logger;
}

interface ForwardResult {
  subscriberId: string;
  url: string;
  status: number | 'timeout' | 'error';
  durationMs: number;
}

/**
 * Forward a captured request to one subscriber. Resolves with a result —
 * never rejects — so Promise.all over many subscribers can't bring down
 * the whole fan-out on a single failure.
 */
export async function forwardOne(args: ForwardArgs): Promise<ForwardResult> {
  const {
    subscriber,
    destinationPath,
    method,
    headers,
    body,
    timeoutMs,
    logger,
  } = args;
  const url = subscriber.url.replace(/\/$/, '') + destinationPath;
  const started = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const fwdHeaders = new Headers(headers);
    // Strip hop-by-hop headers that don't make sense to relay
    fwdHeaders.delete('host');
    fwdHeaders.delete('content-length');
    fwdHeaders.set('x-borradh-router-forward', 'true');
    fwdHeaders.set('x-borradh-router-subscriber-id', subscriber.id);

    const res = await fetch(url, {
      method,
      headers: fwdHeaders,
      body: body.byteLength > 0 ? body : undefined,
      signal: ac.signal,
    });
    if (res.status >= 500) {
      logWarning(
        'webhook-router.forward5xx',
        `Webhook forward returned ${res.status}`,
        {
          feature: 'webhook-router',
          tags: {
            subscriberId: subscriber.id,
            status: String(res.status),
          },
          extra: {
            subscriberId: subscriber.id,
            url,
            status: res.status,
            durationMs: performance.now() - started,
          },
        }
      );
      logger.warn('Webhook forward returned 5xx', {
        subscriberId: subscriber.id,
        url,
        status: res.status,
      });
    }
    return {
      subscriberId: subscriber.id,
      url,
      status: res.status,
      durationMs: performance.now() - started,
    };
  } catch (err) {
    const aborted = ac.signal.aborted;
    logError('webhook-router.forwardFailed', err, {
      feature: 'webhook-router',
      tags: {
        subscriberId: subscriber.id,
        status: aborted ? 'timeout' : 'error',
      },
      extra: {
        subscriberId: subscriber.id,
        url,
        aborted,
        durationMs: performance.now() - started,
      },
    });
    logger.warn('Webhook forward failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      subscriberId: subscriber.id,
      url,
      aborted,
    });
    return {
      subscriberId: subscriber.id,
      url,
      status: aborted ? 'timeout' : 'error',
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fanOut(
  subscribers: Subscriber[],
  shared: Omit<ForwardArgs, 'subscriber'>
): Promise<ForwardResult[]> {
  return Promise.all(
    subscribers.map((s) => forwardOne({ subscriber: s, ...shared }))
  );
}
