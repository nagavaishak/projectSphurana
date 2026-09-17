import { trackedResult } from '@borradh-workspace/observability';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import { resolveStockClipRefs } from '../_shared/resolve-stock-clip-refs.js';
import {
  type SelectStockImageInput,
  selectStockImageSchema,
} from './select-stock-image.schema.js';

export interface SelectedStockImage {
  stockClipId: string;
  /**
   * Whether this clip was matched to the service by technique, or came from
   * the ambient fallback pool. A caller that can generate imagery instead
   * should treat `generic` as "no suitable stock" — the ambient pool answers
   * almost always, so a fallback keyed on an EMPTY result would never fire.
   */
  matchSource: 'service-match' | 'generic';
  /**
   * Unsigned stock object URL. The caller (resolveSlotImage) signs it via
   * resolveReferenceImageUrl before handing it to the renderer.
   */
  url: string;
}

/**
 * Pick one curated stock STILL matched to a service — the image-generation
 * counterpart of selectStockBRoll. Unlike the video path it does NOT mint an
 * asset: resolveSlotImage only needs a URL, so we return the stock object URL
 * directly. Returns null when no image-typed stock matches the service vertical.
 */
const selectStockImageImpl = async (
  db: DbConnection,
  input: SelectStockImageInput
): Promise<Result<SelectedStockImage | null>> => {
  const parsed = selectStockImageSchema.safeParse(input);
  if (!parsed.success) return ok(null);
  const {
    organizationId,
    serviceId,
    excludeStockClipIds,
    rotationSeed,
    vertical,
  } = parsed.data;

  const refs = await resolveStockClipRefs(db, {
    organizationId,
    serviceId,
    count: 1,
    vertical,
    mediaType: 'image',
    excludeStockClipIds,
    rotationSeed,
  });

  const ref = refs[0];
  if (!ref) return ok(null);
  return ok({
    stockClipId: ref.id,
    url: ref.blobUrl,
    matchSource: ref.matchSource,
  });
};

export const selectStockImage = (
  db: DbConnection,
  input: SelectStockImageInput
) =>
  trackedResult(
    'stockFootage.selectStockImage',
    () => selectStockImageImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type SelectStockImageResult = Awaited<
  ReturnType<typeof selectStockImage>
>;
