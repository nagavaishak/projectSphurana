import { CheckCircle2, ImageIcon, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dropzone, DropzoneEmptyState } from '@/components/kibo-ui/dropzone';
import {
  useCreateAsset,
  useDeleteAsset,
  useListAssets,
} from '@/features/assets';
import { useUploadFile } from '@/features/upload';
import { cn } from '@/lib/utils';

const ACCEPTED = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
};
const MAX_SIZE = 500 * 1024 * 1024; // 500MB

interface PendingItem {
  id: string;
  name: string;
  isImage: boolean;
  objectUrl: string;
  status: 'uploading' | 'error';
}

let seq = 0;

/** Small thumbnail box for a saved asset or an in-flight file. */
function Thumb({
  src,
  isImage,
  alt,
}: {
  src?: string;
  isImage: boolean;
  alt: string;
}) {
  return (
    <div className="bg-muted relative size-12 shrink-0 overflow-hidden rounded">
      {!src ? null : isImage ? (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => {
            e.currentTarget.currentTime = 0.001;
          }}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * Inline upload area for the content-upload slide. Uploaded files are
 * registered as org assets and PERSIST across refreshes — the saved assets
 * are re-listed on mount and shown, so a reload never looks empty. Local
 * items exist only while a file is still uploading or has failed; once saved,
 * the asset list refetch takes over. The list is height-capped and scrolls so
 * a big batch can't push Continue off-screen.
 */
export function OnboardingUploadPanel({
  onUploadingChange,
  onCountChange,
  dropzoneClassName,
}: {
  onUploadingChange?: (uploading: boolean) => void;
  onCountChange?: (count: number) => void;
  dropzoneClassName?: string;
}) {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const { assets } = useListAssets();
  const { uploadAsync } = useUploadFile({
    purpose: 'org-asset',
    showToast: false,
  });
  const { createAssetAsync } = useCreateAsset({ showToast: false });
  const { deleteAsset } = useDeleteAsset();

  const uploading = pending.some((it) => it.status === 'uploading');
  useEffect(
    () => onUploadingChange?.(uploading),
    [uploading, onUploadingChange]
  );
  useEffect(
    () => onCountChange?.(assets.length),
    [assets.length, onCountChange]
  );

  // beforeunload guard while uploads are still in flight — a completed upload
  // is saved server-side, but interrupting an in-progress one loses it.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  // Revoke local object URLs on unmount.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    return () => {
      for (const it of pendingRef.current) URL.revokeObjectURL(it.objectUrl);
    };
  }, []);

  const dropPending = useCallback((id: string) => {
    setPending((prev) => {
      const gone = prev.find((it) => it.id === id);
      if (gone) URL.revokeObjectURL(gone.objectUrl);
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const handleDrop = useCallback(
    async (files: File[]) => {
      const fresh: PendingItem[] = files.map((file) => ({
        id: `u${seq++}`,
        name: file.name,
        isImage: file.type.startsWith('image/'),
        objectUrl: URL.createObjectURL(file),
        status: 'uploading',
      }));
      setPending((prev) => [...fresh, ...prev]);

      await Promise.all(
        fresh.map(async (item, i) => {
          const file = files[i];
          try {
            const { url } = await uploadAsync(file);
            // createAsset invalidates the assets query → the saved asset
            // appears from the server list; drop the local placeholder.
            await createAssetAsync({
              file,
              blobUrl: url,
              type: item.isImage ? 'image' : 'video',
            });
            dropPending(item.id);
          } catch {
            setPending((prev) =>
              prev.map((p) =>
                p.id === item.id ? { ...p, status: 'error' } : p
              )
            );
          }
        })
      );
    },
    [uploadAsync, createAssetAsync, dropPending]
  );

  return (
    <div className="flex flex-col gap-4">
      <Dropzone
        accept={ACCEPTED}
        maxFiles={30}
        maxSize={MAX_SIZE}
        onDrop={handleDrop}
        className={cn('min-h-28', dropzoneClassName)}
      >
        <DropzoneEmptyState>
          <div className="flex flex-col items-center gap-1 text-center">
            <ImageIcon className="text-muted-foreground size-6" />
            <p className="text-sm font-medium">
              Drop photos &amp; videos, or click to browse
            </p>
            <p className="text-muted-foreground text-xs">
              I'll use your real footage in the content I make.
            </p>
          </div>
        </DropzoneEmptyState>
      </Dropzone>

      {(pending.length > 0 || assets.length > 0) && (
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
          {/* In-flight / failed uploads */}
          {pending.map((item) => (
            <div
              key={item.id}
              className="border-input flex items-center gap-3 rounded-md border p-2"
            >
              <Thumb
                src={item.objectUrl}
                isImage={item.isImage}
                alt={item.name}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.name}
              </span>
              {item.status === 'uploading' ? (
                <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
              ) : (
                <span className="text-destructive shrink-0 text-xs font-medium">
                  Failed
                </span>
              )}
              <button
                type="button"
                onClick={() => dropPending(item.id)}
                aria-label={`Remove ${item.name}`}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}

          {/* Saved assets — persist across refreshes */}
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="border-input flex items-center gap-3 rounded-md border p-2"
            >
              <Thumb
                src={asset.thumbnailUrl ?? asset.blobUrl}
                isImage={asset.type === 'image'}
                alt={asset.name}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {asset.name}
              </span>
              <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              <button
                type="button"
                onClick={() => deleteAsset(asset.id)}
                aria-label={`Remove ${asset.name}`}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
