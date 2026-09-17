import type { FaceGroupAssetRole } from '@borradh-workspace/api-client/types';
import { faceGroupAssetRoleLabels } from '@borradh-workspace/api-client/types';
import { ArrowLeft, ImageIcon, Video } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type FaceGroupAssetItem,
  useGetFaceGroupAssets,
  useUpdateFaceGroupAssetRole,
} from '@/features/face-groups';

import { useWizard } from './wizard-context';

function AssetCard({ item }: { item: FaceGroupAssetItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isImage = item.asset.type === 'image';
  const { updateRole, isUpdating } = useUpdateFaceGroupAssetRole();
  const { faceGroupId } = useWizard();

  const handleRoleChange = (newRole: string) => {
    if (!faceGroupId) return;
    updateRole({
      groupId: faceGroupId,
      assetId: item.assetId,
      role: newRole as FaceGroupAssetRole,
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-3">
        <div
          className="relative size-[80px] shrink-0 overflow-hidden rounded-lg bg-muted"
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
              src={item.asset.blobUrl}
              alt={item.asset.name}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              src={item.asset.blobUrl}
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
              {isImage ? 'IMG' : 'VID'}
            </Badge>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <p className="truncate text-sm font-medium">{item.asset.name}</p>
          <Select
            defaultValue={item.role}
            onValueChange={handleRoleChange}
            disabled={isUpdating}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(faceGroupAssetRoleLabels).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}

export function StepReviewMedia() {
  const { faceGroupId, goTo, goBack } = useWizard();
  const { faceGroup, assets, isLoading } = useGetFaceGroupAssets(
    faceGroupId ?? ''
  );

  const grouped = useMemo(() => {
    const before = assets.filter((a) => a.role === 'before');
    const after = assets.filter((a) => a.role === 'after');
    const untagged = assets.filter((a) => a.role === 'untagged');
    return { before, after, untagged };
  }, [assets]);

  const hasBothRoles = grouped.before.length > 0 && grouped.after.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={goBack} className="mt-1">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback>
                {faceGroup?.clientName?.[0]?.toUpperCase() ?? '?'}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-semibold">
              {faceGroup?.clientName ?? 'Client'}&apos;s Media
            </h2>
          </div>
          <p className="mt-1 text-muted-foreground">
            Tag assets as Before or After, then continue to configure the video.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`sk-${i}`} className="h-[96px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && assets.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-muted-foreground">
            No assets found for this client.
          </p>
        </div>
      )}

      {!isLoading && assets.length > 0 && (
        <>
          {(['before', 'after', 'untagged'] as const).map((role) => {
            const items = grouped[role];
            if (items.length === 0) return null;
            return (
              <div key={role} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      role === 'before'
                        ? 'default'
                        : role === 'after'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {faceGroupAssetRoleLabels[role]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {items.length} asset{items.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <AssetCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button
              size="lg"
              onClick={() => goTo('configure')}
              disabled={!hasBothRoles}
            >
              {hasBothRoles
                ? 'Continue to Configure'
                : 'Tag Before & After to continue'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
