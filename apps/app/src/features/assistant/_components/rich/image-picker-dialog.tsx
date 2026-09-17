import { useListAssets } from '@/features/assets/api/list-assets';
import { useListAssetsByService } from '@/features/assets/api/list-assets-by-service';
import {
  type AssetContentTypeTag,
  assetContentTypeTagLabels,
} from '@borradh-workspace/api-client/types';
import { Check, ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ContentSelector } from './content-selector';
import {
  buildImagePickerLibrary,
  filterImagePickerLibrary,
} from './image-picker-library';

interface ImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  serviceId?: string | null;
  minCount?: number;
  maxCount?: number;
}

type FilterKey = 'all' | AssetContentTypeTag;
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(
    Object.entries(assetContentTypeTagLabels) as [AssetContentTypeTag, string][]
  ).map(([key, label]) => ({ key, label })),
];

export function ImagePickerDialog({
  open,
  onOpenChange,
  selectedIds,
  onConfirm,
  serviceId,
  minCount = 1,
  maxCount = 10,
}: ImagePickerDialogProps) {
  const [localSelected, setLocalSelected] = useState(selectedIds);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const { assets: allImages, isLoading: loadingAll } = useListAssets({
    type: 'image',
    source: 'raw',
    limit: 100,
  });
  const { assets: serviceAssets, isLoading: loadingService } =
    useListAssetsByService(serviceId ?? '', 'image');

  useEffect(() => {
    if (open) setLocalSelected(selectedIds);
  }, [open, selectedIds]);

  const { ordered, serviceLinked } = useMemo(
    () => buildImagePickerLibrary(allImages, serviceAssets),
    [allImages, serviceAssets]
  );
  const visible = useMemo(
    () => filterImagePickerLibrary(ordered, filter, search),
    [ordered, filter, search]
  );
  const isLoading = loadingAll || (serviceId ? loadingService : false);

  const closeWithoutSaving = () => {
    setLocalSelected(selectedIds);
    onOpenChange(false);
  };
  const toggle = (id: string) => {
    setLocalSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= maxCount) return current;
      return [...current, id];
    });
  };

  return (
    <ContentSelector
      open={open}
      onOpenChange={onOpenChange}
      title="Choose images"
      search={search}
      onSearchChange={setSearch}
      filters={FILTERS}
      filter={filter}
      onFilterChange={setFilter}
      filterLabel="Filter images"
      isLoading={isLoading}
      isEmpty={visible.length === 0}
      empty={
        <div className="flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
          <ImageIcon className="mb-3 size-8 opacity-40" />
          <p>No uploaded images match this filter.</p>
        </div>
      }
      footerNote={
        <>
          <span className="font-medium text-foreground">
            {localSelected.length}
          </span>{' '}
          selected · maximum {maxCount}
        </>
      }
      confirmLabel="Use selected images"
      confirmDisabled={localSelected.length < minCount}
      onConfirm={() => {
        onConfirm(localSelected);
        onOpenChange(false);
      }}
      onCancel={closeWithoutSaving}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visible.map((asset) => {
          const selected = localSelected.includes(asset.id);
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => toggle(asset.id)}
              aria-pressed={selected}
              aria-label={`${selected ? 'Deselect' : 'Select'} ${asset.name}`}
              className={`overflow-hidden rounded-lg border-2 text-left transition-colors ${
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent hover:border-muted-foreground/20'
              }`}
            >
              <div className="relative aspect-[4/5] bg-muted">
                {asset.blobUrl || asset.thumbnailUrl ? (
                  <img
                    src={asset.thumbnailUrl ?? asset.blobUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center">
                    <ImageIcon className="size-8 text-muted-foreground/40" />
                  </div>
                )}
                <span
                  className={`absolute left-1.5 top-1.5 grid size-5 place-items-center rounded border shadow-sm ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-white/80 bg-white text-transparent'
                  }`}
                >
                  <Check className="size-3.5" />
                </span>
                {serviceLinked.has(asset.id) && (
                  <span className="absolute right-1.5 top-1.5 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    Service match
                  </span>
                )}
              </div>
              <p className="truncate p-2 text-xs font-medium">{asset.name}</p>
            </button>
          );
        })}
      </div>
    </ContentSelector>
  );
}
