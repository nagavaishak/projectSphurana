import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ImageCropDialog } from '@/features/upload';

interface PhotoUploadStepProps {
  /** Object URL of the locally-selected (cropped) file, or the persisted photo. */
  previewUrl: string | null;
  isUploading: boolean;
  onFileSelected: (file: File) => void;
}

/**
 * Upload + crop profile photo. Uses a native file input, which on the Capacitor
 * WebView opens the OS camera/gallery picker via `accept`/`capture` — no hard
 * dependency on a native camera plugin (none is installed). If a Capacitor
 * Camera helper is added later, feature-detect and prefer it here.
 *
 * After a file is picked, an interactive crop modal (`PhotoCropDialog`) opens so
 * the user can frame their photo; only the square-cropped result is handed to
 * the container for upload.
 */
export function PhotoUploadStep({
  previewUrl,
  isUploading,
  onFileSelected,
}: PhotoUploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Upload your photo</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;ll crop it to a square for your profile.
        </p>
      </div>

      <button
        type="button"
        className="relative"
        onClick={() => inputRef.current?.click()}
        aria-label="Upload photo"
      >
        <Avatar className="size-32">
          {previewUrl && <AvatarImage src={previewUrl} alt="Profile preview" />}
          <AvatarFallback className="text-2xl">
            <Camera className="size-8 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <span className="bg-primary border-background absolute bottom-1 right-1 rounded-full border-2 p-1.5">
          <Camera className="text-primary-foreground size-4" />
        </span>
      </button>

      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {previewUrl ? 'Change photo' : 'Upload photo'}
      </Button>
      <p className="text-muted-foreground text-xs">
        JPG, PNG or WebP. Max 5MB.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        className="hidden"
        data-testid="photo-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setPendingFile(file);
          // Reset so re-selecting the same file re-triggers onChange.
          e.target.value = '';
        }}
      />

      <ImageCropDialog
        file={pendingFile}
        onCancel={() => setPendingFile(null)}
        onCropped={(cropped) => {
          setPendingFile(null);
          onFileSelected(cropped);
        }}
        description="Drag and resize the circle to frame your profile photo."
      />
    </div>
  );
}
