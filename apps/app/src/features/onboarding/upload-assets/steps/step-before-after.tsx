import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useListBatchAssets } from '@/features/assets';
import type { BatchAssetItem } from '@/features/assets';
import {
  useCreateManualPair,
  useGetBatchFaceGroups,
  useUpdateFaceGroup,
  useUpdateFaceGroupAssetRole,
} from '@/features/face-groups';
import { updateFaceGroupForm } from '@/features/face-groups/components/update-face-group-schema';
import { useListServices } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import { ArrowRight, ImageIcon, Link2, Video } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useUploadContext } from '../upload-context';

/** Labels come from the shared face-group form declaration. */
const FACE_GROUP_LABELS = updateFaceGroupForm.labels;

function AssetThumbnail({
  src,
  name,
  type,
  className,
  selected,
  onClick,
}: {
  src: string;
  name: string;
  type: string;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isImage = type === 'image';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative size-[100px] shrink-0 overflow-hidden rounded-lg bg-muted',
        selected && 'ring-2 ring-primary ring-offset-2',
        onClick && 'cursor-pointer',
        className
      )}
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
          src={src}
          alt={name}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          src={src}
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
        <Badge variant="secondary" className="text-[10px]">
          {isImage ? (
            <ImageIcon className="size-3" />
          ) : (
            <Video className="size-3" />
          )}
        </Badge>
      </div>
    </button>
  );
}

interface FaceGroupRowProps {
  group: {
    id: string;
    clientName: string | null;
    serviceId: string | null;
    assets: Array<{
      id: string;
      assetId: string;
      role: 'before' | 'after' | 'untagged';
      asset: { id: string; name: string; blobUrl: string; type: string };
    }>;
  };
  services: Array<{ id: string; name: string }>;
}

function FaceGroupRow({ group, services }: FaceGroupRowProps) {
  const { updateRole } = useUpdateFaceGroupAssetRole();
  const { updateFaceGroup } = useUpdateFaceGroup();
  const [clientName, setClientName] = useState(group.clientName ?? '');

  const beforeAssets = group.assets.filter((ga) => ga.role === 'before');
  const afterAssets = group.assets.filter((ga) => ga.role === 'after');
  const untaggedAssets = group.assets.filter((ga) => ga.role === 'untagged');

  const handleRoleChange = (assetId: string, role: string) => {
    updateRole({
      groupId: group.id,
      assetId,
      role: role as 'before' | 'after' | 'untagged',
    });
  };

  const handleNameBlur = () => {
    const trimmed = clientName.trim();
    if (trimmed !== (group.clientName ?? '')) {
      updateFaceGroup({ groupId: group.id, clientName: trimmed || undefined });
    }
  };

  const handleServiceChange = (serviceId: string) => {
    updateFaceGroup({
      groupId: group.id,
      serviceId: serviceId === 'none' ? null : serviceId,
    });
  };

  return (
    <div className="flex gap-4 rounded-lg border bg-card p-4">
      {/* Left side: name input + service select */}
      <div className="flex shrink-0 flex-col gap-2">
        <Input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          onBlur={handleNameBlur}
          placeholder="Client name"
          aria-label={FACE_GROUP_LABELS.clientName}
          className="h-8 w-[140px] text-xs"
        />
        {services.length > 0 && (
          <Select
            defaultValue={group.serviceId ?? 'none'}
            onValueChange={handleServiceChange}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Select service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No service</SelectItem>
              {services.map((svc) => (
                <SelectItem key={svc.id} value={svc.id}>
                  {svc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Right side: before → after images */}
      <div className="flex items-center gap-3">
        {/* Before column */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Before
          </span>
          <div className="flex gap-2">
            {beforeAssets.length > 0 ? (
              beforeAssets.map((ga) => (
                <AssetThumbnail
                  key={ga.id}
                  src={ga.asset.blobUrl}
                  name={ga.asset.name}
                  type={ga.asset.type}
                  className="size-[80px]"
                />
              ))
            ) : (
              <div className="flex size-[80px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 text-xs text-muted-foreground">
                None
              </div>
            )}
          </div>
        </div>

        <ArrowRight className="size-5 shrink-0 text-muted-foreground" />

        {/* After column */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            After
          </span>
          <div className="flex gap-2">
            {afterAssets.length > 0 ? (
              afterAssets.map((ga) => (
                <AssetThumbnail
                  key={ga.id}
                  src={ga.asset.blobUrl}
                  name={ga.asset.name}
                  type={ga.asset.type}
                  className="size-[80px]"
                />
              ))
            ) : (
              <div className="flex size-[80px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 text-xs text-muted-foreground">
                None
              </div>
            )}
          </div>
        </div>

        {/* Untagged assets with role selector */}
        {untaggedAssets.length > 0 && (
          <>
            <div className="h-12 w-px shrink-0 bg-border" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Assign role
              </span>
              <div className="flex gap-2">
                {untaggedAssets.map((ga) => (
                  <div
                    key={ga.id}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <AssetThumbnail
                      src={ga.asset.blobUrl}
                      name={ga.asset.name}
                      type={ga.asset.type}
                      className="size-[80px]"
                    />
                    <Select
                      defaultValue={ga.role}
                      onValueChange={(val) => handleRoleChange(ga.assetId, val)}
                    >
                      <SelectTrigger className="h-7 w-[100px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="before">Before</SelectItem>
                        <SelectItem value="after">After</SelectItem>
                        <SelectItem value="untagged">Untagged</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ManualPairingSection({
  unpairedAssets,
  batchId,
}: {
  unpairedAssets: BatchAssetItem[];
  batchId: string;
}) {
  const [selectedBefore, setSelectedBefore] = useState<string | null>(null);
  const [selectedAfter, setSelectedAfter] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const { createManualPair, isCreating } = useCreateManualPair({
    onSuccess: () => {
      setSelectedBefore(null);
      setSelectedAfter(null);
      setClientName('');
    },
  });

  const handleToggle = (assetId: string) => {
    if (selectedBefore === assetId) {
      setSelectedBefore(null);
    } else if (selectedAfter === assetId) {
      setSelectedAfter(null);
    } else if (!selectedBefore) {
      setSelectedBefore(assetId);
    } else if (!selectedAfter) {
      setSelectedAfter(assetId);
    }
  };

  const handleCreatePair = () => {
    if (!selectedBefore || !selectedAfter) return;
    createManualPair({
      batchId,
      beforeAssetId: selectedBefore,
      afterAssetId: selectedAfter,
      clientName: clientName || undefined,
    });
  };

  if (unpairedAssets.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-medium">Unpaired Assets</h3>
        <p className="text-sm text-muted-foreground">
          Select two assets to create a manual before/after pair.
          {selectedBefore
            ? ' Now select the "After" asset.'
            : ' Select the "Before" asset first.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {unpairedAssets.map((asset) => {
          const isBefore = selectedBefore === asset.id;
          const isAfter = selectedAfter === asset.id;
          return (
            <div key={asset.id} className="flex flex-col items-center gap-1">
              <AssetThumbnail
                src={asset.blobUrl}
                name={asset.name}
                type={asset.type}
                selected={isBefore || isAfter}
                onClick={() => handleToggle(asset.id)}
              />
              {isBefore && (
                <Badge variant="default" className="text-[10px]">
                  Before
                </Badge>
              )}
              {isAfter && (
                <Badge variant="default" className="text-[10px]">
                  After
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      {selectedBefore && selectedAfter && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="client-name"
              className="mb-1 block text-sm font-medium"
            >
              Client name (optional)
            </label>
            <Input
              id="client-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g., Sarah"
            />
          </div>
          <Button onClick={handleCreatePair} disabled={isCreating}>
            <Link2 className="size-4" />
            {isCreating ? 'Creating...' : 'Create Pair'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function StepBeforeAfter() {
  const { batchId } = useUploadContext();

  const { faceGroups, isLoading: isLoadingGroups } = useGetBatchFaceGroups(
    batchId ?? ''
  );

  const { services } = useListServices();

  const { assets: beforeAfterAssets, isLoading: isLoadingAssets } =
    useListBatchAssets({
      batchId: batchId ?? '',
      contentType: 'result',
      limit: 100,
    });

  // Find unpaired assets - assets classified as portrait but not in any face group
  const pairedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of faceGroups) {
      for (const ga of group.assets) {
        ids.add(ga.assetId);
      }
    }
    return ids;
  }, [faceGroups]);

  const unpairedAssets = useMemo(
    () => beforeAfterAssets.filter((a) => !pairedAssetIds.has(a.id)),
    [beforeAfterAssets, pairedAssetIds]
  );

  const isLoading = isLoadingGroups || isLoadingAssets;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Before & After Pairing</h2>
        <p className="mt-1 text-muted-foreground">
          Review auto-detected face pairs and assign before/after roles. You can
          also create manual pairs for unmatched assets.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={`skeleton-${i}`} className="h-[160px] w-full" />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          {faceGroups.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-medium">
                Matched Pairs ({faceGroups.length})
              </h3>
              <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
                {faceGroups.map((group) => (
                  <FaceGroupRow
                    key={group.id}
                    group={group}
                    services={services}
                  />
                ))}
              </div>
            </div>
          )}

          {faceGroups.length === 0 && unpairedAssets.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-muted-foreground">
                No before/after assets detected in this batch.
              </p>
              <p className="text-sm text-muted-foreground">
                You can complete the upload process.
              </p>
            </div>
          )}

          {batchId && (
            <ManualPairingSection
              unpairedAssets={unpairedAssets}
              batchId={batchId}
            />
          )}
        </>
      )}
    </div>
  );
}
