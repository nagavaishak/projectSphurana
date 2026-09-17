import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/kibo-ui/dropzone';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUploadImage } from '@/features/upload/api/upload.hook';
import {
  useCreateVenuePhoto,
  useDeleteVenuePhoto,
  useListVenuePhotos,
  useReorderVenuePhotos,
  useSetCoverPhoto,
} from '@/features/venue/api';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  Loader2Icon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface VenuePhotoManagerProps {
  locationId: string;
}

/**
 * Gallery manager for one venue. The photos render as the same hero grid shown
 * on the public page — one large lead image, two stacked to its right, and a
 * "See all images" badge that opens the full manager: upload (presigned →
 * public bucket), reorder (up/down), set the cover, and delete. Captions are
 * set at upload time — the backend exposes no photo-caption update endpoint, so
 * existing captions are shown but not editable inline.
 */
export function VenuePhotoManager({ locationId }: VenuePhotoManagerProps) {
  const { photos, isLoading } = useListVenuePhotos(locationId);
  const { createPhotoAsync, isCreating } = useCreateVenuePhoto(locationId);
  const { reorderPhotos, isReordering } = useReorderVenuePhotos(locationId);
  const { setCover, isSettingCover } = useSetCoverPhoto(locationId);
  const { deletePhoto, isDeleting } = useDeleteVenuePhoto(locationId);

  const [caption, setCaption] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  const { uploadAsync, isUploading } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  const busy = isReordering || isSettingCover || isDeleting || isCreating;

  const handleDrop = async (files: File[]) => {
    for (const file of files) {
      try {
        const result = await uploadAsync(file);
        await createPhotoAsync({
          url: result.url,
          caption: caption.trim() || null,
        });
      } catch {
        toast.error(`Failed to add ${file.name}`);
      }
    }
    setCaption('');
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const ids = photos.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderPhotos(ids);
  };

  const [lead, second, third] = photos;

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading photos…</p>
      ) : photos.length === 0 ? (
        <button
          type="button"
          onClick={() => setManagerOpen(true)}
          className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-muted-foreground transition hover:bg-muted/70"
        >
          <ImageIcon className="size-10" />
          <span className="text-sm">Add photos</span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:h-[480px] sm:grid-cols-3 sm:grid-rows-2">
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="relative aspect-[3/2] overflow-hidden rounded-2xl sm:col-span-2 sm:row-span-2 sm:aspect-auto sm:h-full"
          >
            <img
              src={lead.url}
              alt={lead.caption ?? 'Venue photo'}
              className="h-full w-full object-cover"
            />
            {lead.isCover && (
              <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-background px-3 py-1 font-medium text-xs shadow">
                <StarIcon className="size-3 fill-current" /> Cover
              </span>
            )}
          </button>

          {second && (
            <button
              type="button"
              onClick={() => setManagerOpen(true)}
              className="relative hidden overflow-hidden rounded-2xl sm:block sm:h-full"
            >
              <img
                src={second.url}
                alt={second.caption ?? 'Venue photo'}
                className="h-full w-full object-cover"
              />
            </button>
          )}

          {third && (
            <button
              type="button"
              onClick={() => setManagerOpen(true)}
              className="relative hidden overflow-hidden rounded-2xl sm:block sm:h-full"
            >
              <img
                src={third.url}
                alt={third.caption ?? 'Venue photo'}
                className="h-full w-full object-cover"
              />
              <span className="absolute right-3 bottom-3 rounded-full bg-background px-4 py-2 font-medium text-sm shadow">
                See all images
              </span>
            </button>
          )}
        </div>
      )}

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Venue photos</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption for the next upload (optional)"
              maxLength={200}
            />
            <Dropzone
              accept={{ 'image/*': [] }}
              maxFiles={10}
              multiple
              disabled={isUploading || isCreating}
              onDrop={handleDrop}
              onError={(e) => toast.error(e.message)}
            >
              <DropzoneEmptyState />
              <DropzoneContent />
            </Dropzone>
            {(isUploading || isCreating) && (
              <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Loader2Icon className="size-3 animate-spin" /> Uploading…
              </p>
            )}
          </div>

          {photos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No photos yet. Upload some above — they appear on your public
              venue page.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <li key={photo.id} className="space-y-2 rounded-lg border p-2">
                  <div className="relative">
                    <img
                      src={photo.url}
                      alt={photo.caption ?? 'Venue photo'}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                    {photo.isCover && (
                      <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background px-2 py-1 font-medium text-xs shadow">
                        <StarIcon className="size-3 fill-current" /> Cover
                      </span>
                    )}
                  </div>
                  {photo.caption && (
                    <p className="line-clamp-2 text-muted-foreground text-xs">
                      {photo.caption}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move photo earlier"
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={busy || index === photos.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move photo later"
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                    </div>
                    <div className="flex gap-1">
                      {!photo.isCover && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCover(photo.id)}
                        >
                          Set cover
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => deletePhoto(photo.id)}
                        aria-label="Delete photo"
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
