import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/index.js';
import {
  GetMicrositeDocumentDto,
  ResolveMicrositeHostDto,
} from './dto/index.js';
import {
  resolveMicrositeDocument,
  resolveMicrositeDocumentForHost,
  resolveMicrositeForHost,
} from './resolve-microsite.js';

/**
 * Public (unauthenticated) microsite reads — these serve anonymous website
 * visitors, not our own users, so there is no session to guard on. `@Public()`
 * DECLARES that rather than leaving it to be inferred from the absence of a
 * guard (Gate 3, entry-point-policy).
 *
 * Rate limiting: the global FlyThrottlerGuard keys on the real client IP; the
 * per-route @Throttle below is what actually bounds abuse. `resolve` runs on
 * every cold request across every tenant host, so it gets the larger budget.
 *
 * Caching lives at the EDGE, not here: the Astro page sets a SHORT `s-maxage`
 * with no stale window, because these responses carry live prices and hours
 * beside the published document (see `_microsite-cache.ts` in marketing-astro
 * for why nothing longer is safe, and why the old `Cache-Tag` purge story was
 * never true). This origin stays uncacheable for the document so that a price
 * or hours edit is visible the moment the edge window lapses.
 *
 * Lookup, logging and Result→HTTP translation live in `resolve-microsite.ts`,
 * so the handlers stay at "call the use case, return it" (Gate 5).
 */
@Public()
@Controller('public/microsites')
export class PublicMicrositesController {
  // Host → microsite. Cached upstream in Redis for 5 min (plan §9), so this is
  // hit on cache misses and on every new host.
  @Throttle({ default: { ttl: 60_000, limit: 240 } })
  @Header('Cache-Control', 'public, max-age=60')
  @Get('resolve')
  @UsePipes(new ValidationPipe({ transform: true }))
  async resolve(@Query() dto: ResolveMicrositeHostDto) {
    return resolveMicrositeForHost(dto);
  }

  /**
   * THE RENDERER'S ONE CALL — host → microsite → published document.
   *
   * The route below does the same host resolution internally, so asking
   * `/resolve` first and then `/{id}/document` was two serial Vercel→Fly hops
   * for one answer. Only a cache miss paid it, but a miss is what an ad
   * campaign's first click pays.
   *
   * Published only, by construction: no `mode`, no token. Draft rendering stays
   * on the id-keyed route below, where the preview token is checked against an
   * id supplied by the route rather than derived from the host.
   */
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Header('Cache-Control', 'no-store')
  @Get('document')
  @UsePipes(new ValidationPipe({ transform: true }))
  async documentForHost(@Query() dto: ResolveMicrositeHostDto) {
    return resolveMicrositeDocumentForHost(dto);
  }

  // The document plus the live business data its data-bound blocks read.
  // Id-keyed, and the ONLY route that can serve a draft (with a signed token).
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Header('Cache-Control', 'no-store')
  @Get(':micrositeId/document')
  @UsePipes(new ValidationPipe({ transform: true }))
  async document(
    @Param('micrositeId') micrositeId: string,
    @Query() dto: GetMicrositeDocumentDto
  ) {
    return resolveMicrositeDocument(micrositeId, dto);
  }
}
