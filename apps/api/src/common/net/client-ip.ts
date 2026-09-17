import type { Request } from 'express';

/**
 * The real client IP, resilient behind Fly's proxy.
 *
 * Fly sets `Fly-Client-IP` to the true client address on every request and
 * overwrites any client-supplied value, so it is both accurate and
 * unspoofable — the same source `FlyThrottlerGuard` keys rate limits on. We
 * prefer it over Express `req.ip` (which, even with `trust proxy` set, depends
 * on a correctly-terminated `X-Forwarded-For` chain and is spoofable when the
 * hop count is misconfigured). Falls back to `req.ip` for non-Fly environments
 * (local dev), then to `'unknown'` so callers never persist an empty string.
 *
 * Use this — never a raw `req.ip` — anywhere the captured IP is a security or
 * audit artefact (e.g. the consent-signature `signed_ip` provenance record).
 */
export function getClientIp(req: Request): string {
  const flyClientIp = req.headers['fly-client-ip'];
  if (typeof flyClientIp === 'string' && flyClientIp.length > 0) {
    return flyClientIp;
  }
  return req.ip ?? 'unknown';
}
