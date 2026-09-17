import { trackedResult } from '@borradh-workspace/observability';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  type StockClipRef,
  resolveStockClipRefs,
} from '../_shared/resolve-stock-clip-refs.js';
import {
  type ListServiceStockClipsInput,
  listServiceStockClipsSchema,
} from './list-service-stock-clips.schema.js';

export interface ServiceStockClip {
  stockClipId: string;
  mediaType: 'video' | 'image';
  blobUrl: string;
  transcodedBlobUrl: string | null;
  description: string | null;
  isGeneric: boolean;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

const listServiceStockClipsImpl = async (
  db: DbConnection,
  input: ListServiceStockClipsInput
): Promise<Result<{ items: ServiceStockClip[] }>> => {
  const parsed = listServiceStockClipsSchema.safeParse(input);
  if (!parsed.success) return ok({ items: [] });
  const { organizationId, serviceId, mediaType, limit } = parsed.data;

  const refs = await resolveStockClipRefs(db, {
    organizationId,
    serviceId,
    count: limit,
    mediaType,
    preferMediaType: mediaType ? undefined : 'video',
  });

  return ok({
    items: refs.map((r: StockClipRef) => ({
      stockClipId: r.id,
      mediaType: r.mediaType,
      blobUrl: r.blobUrl,
      transcodedBlobUrl: r.transcodedBlobUrl ?? null,
      description: r.description ?? null,
      isGeneric: !!r.isGeneric,
      durationSec: r.durationSec ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
    })),
  });
};

export const listServiceStockClips = (
  db: DbConnection,
  input: ListServiceStockClipsInput
) =>
  trackedResult(
    'stockFootage.listServiceStockClips',
    () => listServiceStockClipsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type ListServiceStockClipsResult = Awaited<
  ReturnType<typeof listServiceStockClips>
>;
