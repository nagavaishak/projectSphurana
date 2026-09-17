/**
 * Photos arrive straight off a phone: 12MP, 5MB, sometimes sideways. The
 * vision endpoint only needs enough pixels to read a form, and a base64 data
 * URL is 4/3 the byte size of the file, so a 15MB PNG would be a 20MB request.
 * Auto-rotate (EXIF), fit inside 1600px, re-encode as JPEG 80.
 */
const MAX_EDGE_PX = 1600;

export async function prepareImage(
  bytes: Buffer,
  _mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  const { default: sharp } = await import('sharp');
  const out = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize({
      width: MAX_EDGE_PX,
      height: MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
}
