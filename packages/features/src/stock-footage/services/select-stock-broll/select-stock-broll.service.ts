import type { BRollClipConfig } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { rankByDescription } from '../_shared/rank-by-description.js';
import { resolveStockClipRefs } from '../_shared/resolve-stock-clip-refs.js';
import { mintStockAssets } from '../mint-stock-assets/index.js';
import {
  type SelectStockBRollInput,
  selectStockBRollSchema,
} from './select-stock-broll.schema.js';

const selectStockBRollImpl = async (
  db: DbConnection,
  input: SelectStockBRollInput
): Promise<Result<BRollClipConfig[]>> => {
  const parsed = selectStockBRollSchema.safeParse(input);
  if (!parsed.success) return ok([]);
  const { organizationId, serviceId, uploadedById, count, vertical, query } =
    parsed.data;

  // Prefer video clips for b-roll (a video built entirely from stills is weak),
  // but allow stills to fill out the count when the bank is video-thin.
  const refs = await resolveStockClipRefs(db, {
    organizationId,
    serviceId,
    // Resolve a WIDER pool when there is something to rank by — ranking the
    // exact number requested only reorders the clips that were going to be
    // used anyway, which is not a search.
    count: query ? Math.min(20, count * 3) : count,
    vertical,
    preferMediaType: 'video',
  });
  if (refs.length === 0) return ok([]);

  // Best answers to what was asked first, then mint only what is taken. Minting
  // is copy-on-attach and permanent, so ranking BEFORE it keeps the library
  // free of clips nobody chose.
  const ordered = rankByDescription(refs, query).slice(0, count);

  const mintRes = await mintStockAssets(db, {
    organizationId,
    uploadedById,
    stockClipIds: ordered.map((r) => r.id),
  });
  if (!mintRes.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to select stock footage'
      )
    );
  }

  const clips: BRollClipConfig[] = [];
  let order = 0;
  for (const ref of ordered) {
    const assetId = mintRes.data[ref.id];
    if (!assetId) continue;
    clips.push({ assetId, order: order++, clipType: 'bRoll' });
  }
  return ok(clips);
};

export const selectStockBRoll = (
  db: DbConnection,
  input: SelectStockBRollInput
) =>
  trackedResult(
    'stockFootage.selectStockBRoll',
    () => selectStockBRollImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type SelectStockBRollResult = Awaited<
  ReturnType<typeof selectStockBRoll>
>;
