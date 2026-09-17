import {
  StoryAuthor,
  StoryAuthorImage,
  StoryAuthorName,
  StoryOverlay,
} from '@/components/kibo-ui/stories';
import { Skeleton } from '@/components/ui/skeleton';
import type { Asset } from '@/features/assets';
import { useCallback, useState } from 'react';

interface AssetCardProps {
  asset: Asset;
  onClick: () => void;
}

export function AssetCard({ asset, onClick }: AssetCardProps) {
  const [loaded, setLoaded] = useState(false);
  const handleLoaded = useCallback(() => setLoaded(true), []);

  const uploaderName = asset.uploader?.name || 'Unknown User';
  const uploaderImage = asset.uploader?.image || undefined;
  const initials = uploaderName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className="group relative aspect-[3/4] overflow-hidden rounded-xl bg-muted/40 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {!loaded && (
        <Skeleton className="absolute inset-0 size-full rounded-xl" />
      )}
      {asset.type === 'video' ? (
        asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.name}
            className="absolute inset-0 size-full object-cover transition-opacity duration-200 group-hover:opacity-90"
            onLoad={handleLoaded}
          />
        ) : (
          <Skeleton className="absolute inset-0 size-full rounded-xl" />
        )
      ) : (
        <img
          src={asset.blobUrl}
          alt={asset.name}
          className="absolute inset-0 size-full object-cover transition-opacity duration-200 group-hover:opacity-90"
          onLoad={handleLoaded}
        />
      )}
      {loaded && (
        <>
          <StoryOverlay />
          <StoryAuthor>
            <StoryAuthorImage
              fallback={initials}
              name={uploaderName}
              src={uploaderImage}
            />
            <StoryAuthorName>{asset.name}</StoryAuthorName>
          </StoryAuthor>
        </>
      )}
    </div>
  );
}
