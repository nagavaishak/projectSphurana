import type { PixelCrop } from 'react-image-crop';

/**
 * Render the selected crop region of a loaded <img> to a square File.
 *
 * `crop` is in the ReactCrop *display* coordinate space (CSS pixels of the
 * rendered image), so we scale by the image's natural/display ratio to sample
 * the full-resolution source. Output is a square canvas sized to the crop's
 * shorter side, re-encoded at 0.92 quality.
 */
export async function cropImageToFile(
  image: HTMLImageElement,
  crop: PixelCrop,
  fileName: string,
  mimeType = 'image/jpeg'
): Promise<File> {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  const sourceX = crop.x * scaleX;
  const sourceY = crop.y * scaleY;
  const sourceWidth = crop.width * scaleX;
  const sourceHeight = crop.height * scaleY;

  const size = Math.round(Math.min(sourceWidth, sourceHeight));
  if (!size) {
    throw new Error('Empty crop selection');
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    size,
    size
  );

  const type = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.92)
  );
  if (!blob) {
    throw new Error('Could not encode cropped image');
  }

  return new File([blob], fileName, { type: blob.type });
}
