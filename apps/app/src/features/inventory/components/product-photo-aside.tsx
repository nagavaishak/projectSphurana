/**
 * The product editor's photo uploader — the right-hand aside in the design.
 *
 * Built on the same pattern as the booking page's `VenuePhotoManager`: the
 * aside itself is just tiles — one large lead picture with the rest beneath it
 * — and every tile opens a gallery dialog holding the dropzone and the
 * per-picture controls (reorder, set cover, delete). Cramming the dropzone into
 * the 269px aside is what made the pictures small and boxed-in.
 *
 * Unlike venue photos, the tiles use `object-contain` on a muted ground:
 * product shots come in every shape and cropping them to a square hid what was
 * uploaded. Order is meaningful — `images[0]` is the cover the products table
 * shows — so "Set cover" moves a picture to the front.
 *
 * Uploads go to the public bucket ('profile'). Product pictures are rendered
 * straight from their stored URL here, in the products table and on the booking
 * side, so they have to be publicly readable — an 'org-asset' upload lands in
 * the private bucket and every <img> pointing at it 403s. Venue photos upload
 * the same way for the same reason.
 *
 * It reports upload progress upward so the editor can keep Save disabled while
 * a file is still in flight, exactly as the dialog's submit button did.
 */

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
import { Field, FieldLabel } from '@/components/ui/field';
import { useUploadImage } from '@/features/upload/api/upload.hook';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  Loader2Icon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createProductForm } from '../api/create-product/create-product.form';

export function ProductPhotoAside({
  images,
  onChange,
  onUploadingChange,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  onUploadingChange?: (isUploading: boolean) => void;
}) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const { uploadAsync: uploadImage, isUploading } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  const handleDrop = async (files: File[]) => {
    const uploaded: string[] = [];
    for (const file of files) {
      try {
        const result = await uploadImage(file);
        uploaded.push(result.url);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    if (uploaded.length > 0) onChange([...images, ...uploaded]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const setCover = (index: number) =>
    onChange([images[index], ...images.filter((_, i) => i !== index)]);

  const [lead, ...rest] = images;

  return (
    <Field>
      <FieldLabel>{createProductForm.labels.images}</FieldLabel>

      {images.length === 0 ? (
        <button
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-muted-foreground transition hover:bg-muted/70"
          onClick={() => setGalleryOpen(true)}
          type="button"
        >
          <ImageIcon className="size-10" />
          <span className="text-sm">Add pictures</span>
        </button>
      ) : (
        <div className="space-y-2">
          <button
            className="relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted"
            onClick={() => setGalleryOpen(true)}
            type="button"
          >
            <img
              alt="Product"
              className="h-full w-full object-contain p-2"
              src={lead}
            />
            <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-background px-3 py-1 font-medium text-xs shadow">
              <StarIcon className="size-3 fill-current" /> Cover
            </span>
          </button>

          {rest.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {rest.map((url) => (
                <button
                  className="relative block aspect-square w-full overflow-hidden rounded-xl bg-muted"
                  key={url}
                  onClick={() => setGalleryOpen(true)}
                  type="button"
                >
                  <img
                    alt="Product"
                    className="h-full w-full object-contain p-1.5"
                    src={url}
                  />
                </button>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            onClick={() => setGalleryOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {images.length === 1
              ? 'Manage picture'
              : `See all ${images.length} pictures`}
          </Button>
        </div>
      )}

      <Dialog onOpenChange={setGalleryOpen} open={galleryOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product pictures</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Dropzone
              accept={{ 'image/*': [] }}
              disabled={isUploading}
              maxFiles={8}
              multiple
              onDrop={handleDrop}
              onError={(e) => toast.error(e.message)}
            >
              <DropzoneEmptyState />
              <DropzoneContent />
            </Dropzone>
            {isUploading && (
              <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Loader2Icon className="size-3 animate-spin" /> Uploading…
              </p>
            )}
          </div>

          {images.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pictures yet. Upload some above — the first one is used
              wherever this product is listed.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((url, index) => (
                <li className="space-y-2 rounded-lg border p-2" key={url}>
                  <div className="relative">
                    <img
                      alt="Product"
                      className="aspect-square w-full rounded-md bg-muted object-contain p-1"
                      src={url}
                    />
                    {index === 0 && (
                      <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background px-2 py-1 font-medium text-xs shadow">
                        <StarIcon className="size-3 fill-current" /> Cover
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex gap-1">
                      <Button
                        aria-label="Move picture earlier"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        aria-label="Move picture later"
                        disabled={index === images.length - 1}
                        onClick={() => move(index, 1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                    </div>
                    <div className="flex gap-1">
                      {index !== 0 && (
                        <Button
                          onClick={() => setCover(index)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Set cover
                        </Button>
                      )}
                      <Button
                        aria-label="Remove picture"
                        onClick={() =>
                          onChange(images.filter((i) => i !== url))
                        }
                        size="icon"
                        type="button"
                        variant="ghost"
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
    </Field>
  );
}
