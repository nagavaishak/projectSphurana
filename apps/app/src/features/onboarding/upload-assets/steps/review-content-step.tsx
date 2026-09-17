import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type BatchAssetItem,
  useDeleteAsset,
  useLinkAssetServices,
  useListBatchAssets,
  useUnlinkAssetServices,
  useUpdateAssetContentType,
} from '@/features/assets';
import { PendingTaggingNotice } from '@/features/assets/background-analysis';
import {
  type OrganizationService,
  useListServices,
} from '@/features/organization-services';
import { cn } from '@/lib/utils';
import type { AssetContentType } from '@borradh-workspace/api-client/types';
import { assetContentTypeLabels } from '@borradh-workspace/api-client/types';
import {
  AlertTriangle,
  CheckIcon,
  ChevronsUpDown,
  ImageIcon,
  Trash2,
  Video,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useUploadContext } from '../upload-context';

const qualityFlagLabels: Record<string, string> = {
  isShaky: 'Shaky footage',
  isBlurry: 'Blurry image',
  isPoorLighting: 'Poor lighting',
  showsOnlyEquipment: 'Shows only equipment',
  isTooShort: 'Too short',
};

function getQualityInfo(analysis: BatchAssetItem['analysis']) {
  const result = analysis?.analysisResult;
  if (!result) return null;
  const score =
    typeof result.qualityScore === 'number' ? result.qualityScore : null;
  if (score === null) return null;
  const flags = (result.qualityFlags ?? {}) as Record<string, boolean>;
  const activeFlags = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => qualityFlagLabels[k] ?? k);
  return { score, activeFlags };
}

interface ReviewContentStepProps {
  contentType?: AssetContentType;
  contentTypeIn?: AssetContentType[];
  title: string;
  description: string;
  emptyMessage: string;
}

function QualityBadge({ asset }: { asset: BatchAssetItem }) {
  const quality = getQualityInfo(asset.analysis);
  if (!quality || quality.score >= 0.7) return null;

  const isLow = quality.score < 0.4;
  const label = isLow ? 'Low quality' : 'Fair quality';
  const flagSummary =
    quality.activeFlags.length > 0
      ? quality.activeFlags.join(', ')
      : `Quality score: ${Math.round(quality.score * 100)}%`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`gap-1 text-[10px] ${
            isLow
              ? 'border-destructive/50 text-destructive'
              : 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400'
          }`}
        >
          <AlertTriangle className="size-3" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{flagSummary}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface AssetReviewCardProps {
  asset: BatchAssetItem;
  services: OrganizationService[];
}

export function AssetReviewCard({ asset, services }: AssetReviewCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isImage = asset.type === 'image';
  const { deleteAsset, isDeleting } = useDeleteAsset();
  const { updateContentType, isUpdating } = useUpdateAssetContentType();
  const { linkServices } = useLinkAssetServices();
  const { unlinkServices } = useUnlinkAssetServices();

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    asset.serviceIds ?? []
  );
  const [servicesPopoverOpen, setServicesPopoverOpen] = useState(false);

  const handleRecategorize = (newType: string) => {
    updateContentType({
      assetId: asset.id,
      contentType: newType as AssetContentType,
    });
  };

  const toggleService = (serviceId: string) => {
    const isSelected = selectedServiceIds.includes(serviceId);
    if (isSelected) {
      setSelectedServiceIds((prev) => prev.filter((id) => id !== serviceId));
      unlinkServices({ assetId: asset.id, serviceIds: [serviceId] });
    } else {
      setSelectedServiceIds((prev) => [...prev, serviceId]);
      linkServices({ assetId: asset.id, serviceIds: [serviceId] });
    }
  };

  const getSelectedServicesLabel = () => {
    if (selectedServiceIds.length === 0) return 'Select services';
    if (selectedServiceIds.length === 1) {
      const svc = services.find((s) => s.id === selectedServiceIds[0]);
      return svc?.name ?? '1 service';
    }
    return `${selectedServiceIds.length} services`;
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-3">
        <div
          className="relative size-[100px] shrink-0 overflow-hidden rounded-lg bg-muted"
          onMouseEnter={() => {
            if (!isImage) videoRef.current?.play();
          }}
          onMouseLeave={() => {
            if (!isImage && videoRef.current) {
              videoRef.current.pause();
              videoRef.current.currentTime = 0;
            }
          }}
        >
          {isImage ? (
            <img
              src={asset.blobUrl}
              alt={asset.name}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              src={asset.blobUrl}
              className="absolute inset-0 size-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                e.currentTarget.currentTime = 0.001;
              }}
            />
          )}
          <div className="absolute bottom-1 left-1">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {isImage ? (
                <ImageIcon className="size-3" />
              ) : (
                <Video className="size-3" />
              )}
              {isImage ? 'Image' : 'Video'}
            </Badge>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{asset.name}</p>
            <QualityBadge asset={asset} />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="ml-auto size-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => deleteAsset(asset.id)}
              disabled={isDeleting}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Select
              defaultValue={asset.analysis?.contentType ?? undefined}
              onValueChange={handleRecategorize}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Content type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(assetContentTypeLabels).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            {services.length > 0 && (
              <Popover
                open={servicesPopoverOpen}
                onOpenChange={setServicesPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={servicesPopoverOpen}
                    className="h-8 w-full justify-between text-xs"
                    type="button"
                  >
                    <span className="truncate">
                      {getSelectedServicesLabel()}
                    </span>
                    <div className="flex items-center gap-1">
                      {selectedServiceIds.length > 0 && (
                        <Badge variant="secondary" className="ml-1 text-[10px]">
                          {selectedServiceIds.length}
                        </Badge>
                      )}
                      <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
                    </div>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search services..."
                      className="h-8 text-xs"
                    />
                    <CommandList>
                      <CommandEmpty>No services found.</CommandEmpty>
                      <CommandGroup>
                        {services.map((service) => (
                          <CommandItem
                            key={service.id}
                            value={service.name}
                            onSelect={() => toggleService(service.id)}
                          >
                            <div
                              className={cn(
                                'mr-2 flex size-4 items-center justify-center rounded-sm border border-primary',
                                selectedServiceIds.includes(service.id)
                                  ? 'bg-primary text-primary-foreground'
                                  : 'opacity-50 [&_svg]:invisible'
                              )}
                            >
                              <CheckIcon className="size-3" />
                            </div>
                            <span className="truncate text-xs">
                              {service.name}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ReviewContentStep({
  contentType,
  contentTypeIn,
  title,
  description,
  emptyMessage,
}: ReviewContentStepProps) {
  const { batchId } = useUploadContext();

  const { assets, isLoading } = useListBatchAssets({
    batchId: batchId ?? '',
    contentType,
    contentTypeIn,
    limit: 100,
  });

  const { services } = useListServices();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>

      <PendingTaggingNotice />

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skeleton-${i}`} className="h-[120px] w-full" />
          ))}
        </div>
      )}

      {!isLoading && assets.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-muted-foreground">{emptyMessage}</p>
          <p className="text-sm text-muted-foreground">
            You can continue to the next step.
          </p>
        </div>
      )}

      {!isLoading && assets.length > 0 && (
        <div className="flex flex-col gap-3">
          <Badge variant="secondary" className="w-fit">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
          </Badge>
          <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
            {assets.map((asset) => (
              <AssetReviewCard
                key={asset.id}
                asset={asset}
                services={services}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
