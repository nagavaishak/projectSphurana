import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Image as ImageIcon, Video } from 'lucide-react';

/** Grid row shape for the content library (mirrors `ContentItem` in content-library). */
export interface ContentLibraryCardItem {
  id: string;
  title: string;
  type: 'video' | 'image';
  thumbnailUrl: string | null;
  duration: number | null;
  createdAt: string;
}

interface ContentCardProps {
  item: ContentLibraryCardItem;
  isSelected: boolean;
  onSelect: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ContentCard({ item, isSelected, onSelect }: ContentCardProps) {
  const isVideo = item.type === 'video';

  return (
    <Card
      className={`group cursor-pointer transition-all hover:shadow-md py-0 ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
      onClick={onSelect}
    >
      <div className="relative aspect-video w-full bg-muted overflow-hidden rounded-t-xl">
        {item.thumbnailUrl ? (
          isVideo ? (
            <video
              src={item.thumbnailUrl}
              className="object-cover w-full h-full"
              muted
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                e.currentTarget.currentTime = 0.001;
              }}
            />
          ) : (
            <img
              src={item.thumbnailUrl}
              alt={item.title}
              className="absolute inset-0 size-full object-cover"
            />
          )
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            {isVideo ? (
              <Video className="size-12 text-muted-foreground" />
            ) : (
              <ImageIcon className="size-12 text-muted-foreground" />
            )}
          </div>
        )}

        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="text-xs">
            {isVideo ? 'Video' : 'Image'}
          </Badge>
        </div>

        {isVideo && item.duration ? (
          <div className="absolute bottom-2 right-2">
            <Badge
              variant="secondary"
              className="text-xs bg-black/70 text-white"
            >
              {formatDuration(item.duration)}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="p-4 space-y-1">
        <h3 className="font-semibold text-sm line-clamp-1">{item.title}</h3>
        <p className="text-xs text-muted-foreground">
          Created {item.createdAt}
        </p>
      </div>
    </Card>
  );
}
