import { CheckCircleIcon, EyeIcon, ImageIcon, VideoIcon } from 'lucide-react';
import { VideoThumbnail } from './video-thumbnail';

interface SelectableVideoCardProps {
  asset: {
    id: string;
    name: string;
    blobUrl: string | null;
    duration: number | string | null;
    type?: 'video' | 'image';
  };
  isSelected: boolean;
  isDisabled?: boolean;
  serviceName?: string | null;
  onToggle: () => void;
  onPreview: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SelectableVideoCard({
  asset,
  isSelected,
  isDisabled,
  serviceName,
  onToggle,
  onPreview,
}: SelectableVideoCardProps) {
  const disabled = isDisabled && !isSelected;
  const isImage = asset.type === 'image';
  const PlaceholderIcon = isImage ? ImageIcon : VideoIcon;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative group text-left rounded-lg overflow-hidden border-2 transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5'
          : disabled
            ? 'border-transparent opacity-50 cursor-not-allowed'
            : 'border-transparent hover:border-muted-foreground/20'
      }`}
    >
      <div className="aspect-video bg-muted relative">
        {asset.blobUrl ? (
          <VideoThumbnail
            src={asset.blobUrl}
            className="w-full h-full"
            isImage={isImage}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PlaceholderIcon className="size-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Preview button (top-right on hover) */}
        {!disabled && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onPreview();
              }
            }}
            className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-1.5 cursor-pointer"
          >
            <EyeIcon className="size-4 text-white" />
          </div>
        )}

        {/* Selected indicator */}
        {isSelected && (
          <div className="absolute top-2 right-2">
            <CheckCircleIcon className="size-5 text-primary" />
          </div>
        )}

        {/* Duration badge (videos only) */}
        {!isImage && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {formatDuration(
              typeof asset.duration === 'string'
                ? Number(asset.duration)
                : asset.duration
            )}
          </span>
        )}
        {isImage && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
            <ImageIcon className="size-3" />
            Photo
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-medium truncate">{asset.name}</p>
        {serviceName && (
          <p className="text-xs text-muted-foreground truncate">
            {serviceName}
          </p>
        )}
      </div>
    </button>
  );
}
