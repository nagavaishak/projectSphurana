import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCreateAsset } from '@/features/assets/api/create-asset';
import { useListAssets } from '@/features/assets/api/list-assets';
import { useListAssetsByService } from '@/features/assets/api/list-assets-by-service';
import { useListServices } from '@/features/organization-services';
import { useUploadFile } from '@/features/upload/api/upload.hook';
import {
  AlertCircleIcon,
  Loader2Icon,
  SearchIcon,
  SparklesIcon,
  UploadIcon,
  VideoIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import type { VideoFormData } from '../../-schema';
import type { SlotConfig } from '../../data/-slot-config';
import { ClipPreviewDialog } from '../dialogs/clip-preview-dialog';
import { SelectableVideoCard } from '../shared/selectable-video-card';

const CLIP_TAG_LABELS: Record<string, string> = {
  all: 'All Media',
  before: 'Before',
  after: 'After',
  procedure: 'Procedure',
  environment: 'Clinic / Environment',
  'employee-talking-head': 'Employee / Talking Head',
  testimonial: 'Testimonial',
  'pending-result': 'Pending Result',
  other: 'Other',
};

interface MediaSelectionStepProps {
  form: UseFormReturn<VideoFormData>;
  slot: SlotConfig;
}

export function MediaSelectionStep({ form, slot }: MediaSelectionStepProps) {
  const { clearErrors, watch, setValue } = form;
  const { templateId } = useVideoCreation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>(slot.filterTag || 'all');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch assets with optional tag filter (includes both videos and images)
  const { assets, isLoading, isError, refetch } = useListAssets({
    tags: activeTag !== 'all' ? [activeTag] : undefined,
  });

  // Fetch service-linked assets when a service is selected (for offer templates)
  const serviceId = watch('serviceId') || '';
  const { assets: serviceAssets } = useListAssetsByService(serviceId);

  // Get service name for display on cards
  const { services } = useListServices({ limit: 100 });
  const selectedService = serviceId
    ? services.find((s) => s.id === serviceId)
    : null;
  const selectedServiceName = selectedService?.name ?? null;

  // Build a set of service-linked asset IDs for sorting
  const serviceAssetIds = useMemo(
    () => new Set(serviceAssets.map((a) => a.id)),
    [serviceAssets]
  );

  const { createAssetAsync } = useCreateAsset();
  const { uploadAsync } = useUploadFile({
    onProgress: (progress) => setUploadProgress(progress),
  });

  // Auto-select ref — declared here so it's available in the useEffect below
  const hasAutoSelected = useRef(false);

  // Merge service-linked assets into tag-filtered results (they may lack the tag
  // but are still relevant), then apply search query and sort service-linked first.
  const filteredAssets = useMemo(() => {
    let result = assets;

    // When a tag filter is active, include service-linked assets that the tag
    // query missed (e.g. AI classified them differently). Deduplicate by ID.
    if (activeTag !== 'all' && serviceAssets.length > 0) {
      const tagAssetIds = new Set(assets.map((a) => a.id));
      const missing = serviceAssets.filter((a) => !tagAssetIds.has(a.id));
      if (missing.length > 0) {
        result = [...assets, ...missing];
      }
    }

    // Client-side search filter
    if (searchQuery) {
      result = result.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort service-linked assets first when a service is selected
    if (serviceAssetIds.size > 0) {
      result = [...result].sort((a, b) => {
        const aLinked = serviceAssetIds.has(a.id) ? 0 : 1;
        const bLinked = serviceAssetIds.has(b.id) ? 0 : 1;
        return aLinked - bLinked;
      });
    }

    return result;
  }, [assets, searchQuery, serviceAssetIds, activeTag, serviceAssets]);

  // Read current selections from form
  const clips = watch('clips') || { bRoll: [], templateSlots: {} };
  const allowStockFootage = watch('allowStockFootage') ?? false;
  const canUseStockFootage = templateId !== 'before-after';

  const getSelectedIds = (): string[] => {
    if (slot.order !== undefined) {
      const slotValue = clips.templateSlots?.[String(slot.order)];
      return Array.isArray(slotValue)
        ? slotValue
        : slotValue
          ? [slotValue]
          : [];
    }
    return clips.bRoll || [];
  };

  const selectedIds = getSelectedIds();
  const isSingleSelect = slot.maxCount === 1;
  const isAtMax = !isSingleSelect && selectedIds.length >= slot.maxCount;

  const handleToggle = (assetId: string) => {
    if (slot.order !== undefined) {
      const orderKey = String(slot.order);
      const current = [...selectedIds];

      if (isSingleSelect) {
        // Single select — toggle
        const updated = { ...clips.templateSlots };
        if (current[0] === assetId) {
          delete updated[orderKey];
        } else {
          updated[orderKey] = [assetId];
        }
        setValue('clips.templateSlots', updated, { shouldValidate: true });
      } else {
        // Multi select — toggle in/out
        const updated = { ...clips.templateSlots };
        const idx = current.indexOf(assetId);
        if (idx >= 0) {
          current.splice(idx, 1);
        } else if (current.length < slot.maxCount) {
          current.push(assetId);
        }
        if (current.length > 0) {
          updated[orderKey] = current;
        } else {
          delete updated[orderKey];
        }
        setValue('clips.templateSlots', updated, { shouldValidate: true });
      }
    } else {
      // Unordered b-roll fallback
      const current = [...(clips.bRoll || [])];
      const idx = current.indexOf(assetId);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else if (current.length < slot.maxCount) {
        current.push(assetId);
      }
      setValue('clips.bRoll', current, { shouldValidate: true });
    }
  };

  // Auto-select clips if slot is empty on first load
  // Prefers service-linked assets when available, falls back to random
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleToggle changes every render but hasAutoSelected ref ensures this runs once
  useEffect(() => {
    if (hasAutoSelected.current || isLoading || assets.length === 0) return;
    if (selectedIds.length > 0) {
      hasAutoSelected.current = true;
      return;
    }

    // Prefer service-linked assets when available
    const preferredAssets = serviceAssets.length > 0 ? serviceAssets : assets;
    const maxToSelect = Math.min(slot.maxCount, preferredAssets.length);
    for (let i = 0; i < maxToSelect; i++) {
      handleToggle(preferredAssets[i].id);
    }
    hasAutoSelected.current = true;
  }, [isLoading, assets, selectedIds.length, serviceAssets]);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (
      !file ||
      !(file.type.startsWith('video/') || file.type.startsWith('image/'))
    )
      return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const uploadResult = await uploadAsync(file);

      const tags = [slot.filterTag, 'background'].filter(Boolean) as string[];

      const asset = await createAssetAsync({
        file,
        blobUrl: uploadResult.url,
        tags,
      });

      // Auto-select the uploaded asset
      handleToggle(asset.id);
      await refetch();
    } catch (error) {
      console.error('Failed to upload video:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const previewAsset = previewAssetId
    ? (filteredAssets.find((a) => a.id === previewAssetId) ?? null)
    : null;

  return (
    <div
      className="flex flex-col gap-4"
      data-claire-target="create-video-media-step"
    >
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">{slot.label}</h2>
        <p className="text-sm text-muted-foreground mt-1">{slot.description}</p>
        {!isSingleSelect && (
          <p className="text-sm text-muted-foreground mt-1">
            {selectedIds.length} of {slot.maxCount} selected
          </p>
        )}
        {isSingleSelect && selectedIds.length > 0 && (
          <p className="text-sm text-primary mt-1">1 video selected</p>
        )}
      </div>

      {canUseStockFootage && (
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="grid gap-0.5 pr-4">
            <Label
              htmlFor={`stock-footage-${slot.order ?? slot.type}`}
              className="flex items-center gap-2 text-sm"
            >
              <SparklesIcon className="size-4 text-muted-foreground" />
              Use curated stock footage
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave this slot empty to auto-fill relevant stock clips at render
              time, or turn this on to hand-pick clips in the final step.
            </p>
          </div>
          <Switch
            id={`stock-footage-${slot.order ?? slot.type}`}
            checked={allowStockFootage}
            onCheckedChange={(checked) => {
              setValue('allowStockFootage', checked, {
                shouldDirty: true,
                shouldValidate: true,
              });
              if (checked) clearErrors('clips');
            }}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative w-full flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={activeTag} onValueChange={setActiveTag}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CLIP_TAG_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full gap-2 md:w-auto"
        >
          <UploadIcon className="size-4" />
          Upload
        </Button>
      </div>

      {/* Upload progress */}
      {isUploading && (
        <div className="p-4 border rounded-lg bg-muted/50">
          <div className="flex items-center gap-3 mb-2">
            <Loader2Icon className="size-4 animate-spin" />
            <span className="text-sm font-medium">Uploading video...</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            {uploadProgress}%
          </p>
        </div>
      )}

      {/* Video grid */}
      <div className="flex-1 min-h-0">
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div key={`skeleton-${n}`} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertCircleIcon className="size-12 mb-4" />
            <p>Failed to load videos. Please try again.</p>
          </div>
        )}

        {!isLoading &&
          !isError &&
          filteredAssets.length === 0 &&
          !isUploading && (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <VideoIcon />
                </EmptyMedia>
                <EmptyTitle>No videos found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery
                    ? `No videos match "${searchQuery}". Try a different search or upload a new video.`
                    : `Upload a video for the ${slot.label.toLowerCase()} slot.`}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <UploadIcon className="size-4" />
                  Upload Video
                </Button>
              </EmptyContent>
            </Empty>
          )}

        {!isLoading && !isError && filteredAssets.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredAssets.map((asset) => (
              <SelectableVideoCard
                key={asset.id}
                asset={asset}
                isSelected={selectedIds.includes(asset.id)}
                isDisabled={isAtMax}
                serviceName={
                  serviceAssetIds.has(asset.id) ? selectedServiceName : null
                }
                onToggle={() => handleToggle(asset.id)}
                onPreview={() => setPreviewAssetId(asset.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Clip preview dialog */}
      <ClipPreviewDialog
        asset={previewAsset}
        isSelected={
          previewAssetId ? selectedIds.includes(previewAssetId) : false
        }
        onToggleSelect={() => {
          if (previewAssetId) handleToggle(previewAssetId);
        }}
        open={!!previewAssetId}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPreviewAssetId(null);
        }}
      />
    </div>
  );
}
