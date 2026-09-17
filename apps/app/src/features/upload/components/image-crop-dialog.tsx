import { useRef, useState } from 'react';
import ReactCrop, {
  centerCrop,
  type Crop,
  makeAspectCrop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { cropImageToFile } from '../crop-image-to-file';

interface ImageCropDialogProps {
  /** The raw file the user just selected, or null when the dialog is closed. */
  file: File | null;
  onCancel: () => void;
  onCropped: (file: File) => void;
  /** Render the crop as a circle (still exports a square file). Default true. */
  circular?: boolean;
  title?: string;
  description?: string;
}

/** Build a centered square crop covering as much of the image as possible. */
function centeredSquareCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
    width,
    height
  );
}

/**
 * Interactive square-crop modal shown right after a photo is selected. The user
 * adjusts the framing; on Apply we render the selection to a square File via
 * canvas and hand it back to the caller, which uploads it. Cancelling discards
 * the selection.
 *
 * Shared by every profile-photo surface (invited-member wizard, profile
 * settings, team-member editor) so cropping behaves identically everywhere.
 */
export function ImageCropDialog({
  file,
  onCancel,
  onCropped,
  circular = true,
  title = 'Crop your photo',
  description = 'Drag and resize to frame your photo.',
}: ImageCropDialogProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isProcessing, setIsProcessing] = useState(false);

  const open = file !== null;

  // Create/revoke the object URL as the incoming file changes.
  const lastFileRef = useRef<File | null>(null);
  if (file !== lastFileRef.current) {
    lastFileRef.current = file;
    setCompletedCrop(undefined);
    setCrop(undefined);
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(file ? URL.createObjectURL(file) : null);
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    setCrop(centeredSquareCrop(width, height));
  };

  const handleClose = () => {
    if (imageSrc) {
      URL.revokeObjectURL(imageSrc);
      setImageSrc(null);
    }
    onCancel();
  };

  const handleApply = async () => {
    if (
      !file ||
      !imgRef.current ||
      !completedCrop?.width ||
      !completedCrop.height
    ) {
      return;
    }
    setIsProcessing(true);
    try {
      const cropped = await cropImageToFile(
        imgRef.current,
        completedCrop,
        file.name,
        file.type
      );
      if (imageSrc) {
        URL.revokeObjectURL(imageSrc);
        setImageSrc(null);
      }
      onCropped(cropped);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {imageSrc && (
          <div className="flex justify-center overflow-hidden">
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
              aspect={1}
              circularCrop={circular}
              keepSelection
              minWidth={40}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                onLoad={handleImageLoad}
                className="max-h-[60vh] w-auto object-contain"
              />
            </ReactCrop>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={isProcessing || !completedCrop?.width}
            data-testid="image-crop-apply"
          >
            {isProcessing ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
