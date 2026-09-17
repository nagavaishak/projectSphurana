import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard that keys rate limits on the REAL client IP.
 *
 * Behind Fly's proxy, Express `req.ip` is a rotating internal proxy address
 * (e.g. 172.16.x.x), so the stock tracker buckets unrelated clients together —
 * a global guard would then rate-limit the whole API as if it were one IP.
 * Fly sets `Fly-Client-IP` to the true client address on every request and
 * overwrites any client-supplied value, so it's both accurate and unspoofable.
 * Falls back to `req.ip` for non-Fly environments (local dev).
 */
@Injectable()
export class FlyThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>
  ): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const flyClientIp = headers['fly-client-ip'];
    if (typeof flyClientIp === 'string' && flyClientIp.length > 0) {
      return flyClientIp;
    }
    return (req.ip as string) ?? 'unknown';
  }
}
