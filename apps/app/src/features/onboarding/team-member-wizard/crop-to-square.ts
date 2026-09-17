/**
 * Center-crop an image file to a square.
 *
 * A full interactive cropper isn't available in this app (no crop library is
 * installed), so the wizard applies a deterministic centre square-crop before
 * upload — the common case for a profile avatar. Swap this for an interactive
 * cropper component later without touching the wizard's call site.
 *
 * Falls back to the original file if the browser can't decode/canvas the image
 * (e.g. non-DOM test environments).
 */
export async function cropToSquare(file: File): Promise<File> {
  if (typeof document === 'undefined') return file;
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const size = Math.min(img.width, img.height);
    if (!size) return file;

    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type || 'image/jpeg', 0.92)
    );
    if (!blob) return file;

    return new File([blob], file.name, { type: blob.type });
  } catch {
    return file;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}
