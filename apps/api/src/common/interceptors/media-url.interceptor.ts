import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, from, switchMap } from 'rxjs';
import {
  MEDIA_URLS_KEY,
  type MediaFieldSpec,
  type MediaUrlsSpec,
} from '../decorators/media-urls.decorator.js';
import { applyStrategy } from './media-url.resolver.js';

/**
 * Resolves / re-signs the media URLs on a response — the OUTPUT-SHAPING half of
 * Gate 5 ("response shaping → an Interceptor"), and the sibling of
 * `ResponseContractInterceptor`.
 *
 * Before this existed, three controllers each carried their own private
 * `getAssetUrl` / `resolveMediaUrl` / `resignCdnUrl` helper plus a hand-rolled
 * `Promise.all` fan-out inside every read handler. The rules themselves now live
 * in `media-url.resolver.ts`; this interceptor is only the WALKER: it reads the
 * `@MediaUrls({...})` spec off the route and applies the named strategy to each
 * declared path.
 *
 * A route with no `@MediaUrls` decorator passes straight through — zero
 * overhead, and no way to accidentally sign a payload that must not be signed
 * (e.g. `POST /social-posts/:id/publish`, whose synthetic response is
 * deliberately unsigned today).
 *
 * BEHAVIOUR THIS PRESERVES (pinned by the characterization suites):
 *  - a declared field is ALWAYS written when its parent object exists, even when
 *    the stored value is null — that is how `graphicImageUrl: null` and
 *    `video.blobUrl: null` reach the client today;
 *  - a declared field whose PARENT is absent is skipped entirely, so an ad with
 *    no video still serializes with no `video` key at all;
 *  - `strip` runs AFTER resolution, so a `graphic` field can still read its
 *    sibling object key before that key is removed from the payload.
 */
@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<MediaUrlsSpec | undefined>(
      MEDIA_URLS_KEY,
      context.getHandler()
    );
    if (!spec) return next.handle();

    // `?urlFormat=presigned` bypasses the CDN for native media players. Only
    // honoured on routes that opt in, so other routes cannot be flipped into
    // presigned mode by an unexpected query string.
    const query = context.switchToHttp().getRequest<{
      query?: Record<string, unknown>;
    }>().query;
    const forcePresigned =
      spec.alwaysPresigned === true ||
      (spec.honorUrlFormatQuery === true && query?.urlFormat === 'presigned');

    return next
      .handle()
      .pipe(switchMap((body) => from(this.shape(body, spec, forcePresigned))));
  }

  private async shape(
    body: unknown,
    spec: MediaUrlsSpec,
    forcePresigned: boolean
  ): Promise<unknown> {
    if (body === null || typeof body !== 'object') return body;

    if (!spec.collection) {
      return shapeItem(body as Record<string, unknown>, spec, forcePresigned);
    }

    const envelope = body as Record<string, unknown>;
    const items = envelope[spec.collection];
    if (!Array.isArray(items)) return body;

    return {
      ...envelope,
      [spec.collection]: await Promise.all(
        items.map((item) =>
          item !== null && typeof item === 'object'
            ? shapeItem(item as Record<string, unknown>, spec, forcePresigned)
            : item
        )
      ),
    };
  }
}

/**
 * Rewrite one item. Containers are cloned only along the touched paths — the
 * same shallow-spread the handlers did by hand — so nothing else in the payload
 * is copied or reordered.
 */
async function shapeItem(
  item: Record<string, unknown>,
  spec: MediaUrlsSpec,
  forcePresigned: boolean
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...item };

  for (const field of spec.fields) {
    const parent = cloneToParent(out, field);
    if (!parent) continue;

    const leaf = field.path.slice(field.path.lastIndexOf('.') + 1);
    parent[leaf] = await applyStrategy(field.strategy, parent[leaf], {
      forcePresigned,
      key: field.keyField
        ? (parent[field.keyField] ?? out[field.keyField])
        : undefined,
    });
  }

  for (const key of spec.strip ?? []) delete out[key];
  return out;
}

/**
 * Walk to (and shallow-clone) the object holding the leaf of `field.path`.
 * Returns null when an intermediate object is missing — that path is then left
 * alone, which is how "ad with no video" keeps serializing without a `video`
 * key.
 */
function cloneToParent(
  root: Record<string, unknown>,
  field: MediaFieldSpec
): Record<string, unknown> | null {
  const segments = field.path.split('.');
  segments.pop();

  let parent = root;
  for (const segment of segments) {
    const next = parent[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      return null;
    }
    const clone = { ...(next as Record<string, unknown>) };
    parent[segment] = clone;
    parent = clone;
  }
  return parent;
}
