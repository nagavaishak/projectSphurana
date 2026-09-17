import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useListBatchAssets } from '@/features/assets';
import { useListServices } from '@/features/organization-services';
import type { AssetContentType } from '@borradh-workspace/api-client/types';
import { useUploadContext } from '../upload-context';
import { AssetReviewCard, ReviewContentStep } from './review-content-step';

/** Content types shown in the supplementary review step */
const SUPPLEMENTARY_CONTENT_TYPES: AssetContentType[] = [
  'procedure',
  'environment',
];

/** Content types that have their own dedicated review steps */
const REVIEWED_CONTENT_TYPES: AssetContentType[] = [
  ...SUPPLEMENTARY_CONTENT_TYPES,
  'talking_head',
  'result',
];

function OtherAssetsSection() {
  const { batchId } = useUploadContext();

  const { assets, isLoading } = useListBatchAssets({
    batchId: batchId ?? '',
    contentTypeNotIn: REVIEWED_CONTENT_TYPES,
    limit: 100,
  });

  const { services } = useListServices();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={`skeleton-other-${i}`} className="h-[120px] w-full" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">Other Assets</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          These assets weren&apos;t classified into any known category. Use the
          dropdown to assign the correct content type.
        </p>
      </div>
      <Badge variant="secondary" className="w-fit">
        {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
      </Badge>
      <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
        {assets.map((asset) => (
          <AssetReviewCard key={asset.id} asset={asset} services={services} />
        ))}
      </div>
    </div>
  );
}

export function StepReviewBroll() {
  return (
    <div className="flex flex-col gap-8">
      <ReviewContentStep
        contentTypeIn={SUPPLEMENTARY_CONTENT_TYPES}
        title="Review Supplementary Assets"
        description="These assets were classified as procedures, environment shots, or B-Roll. You can re-categorize or remove any that don't belong."
        emptyMessage="No supplementary assets detected in this batch."
      />
      <OtherAssetsSection />
    </div>
  );
}
