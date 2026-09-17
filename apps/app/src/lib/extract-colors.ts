/**
 * Canvas-based color extraction for logo images.
 *
 * Runs on a Blob/File in the browser (no CORS issues since the image
 * hasn't been uploaded yet). Extracts:
 *   - backgroundColor: the most common color in the 4 corners
 *   - dominantColor: the most common non-background color
 */

/** Load an image element from a File/Blob */
function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/** Convert RGB values to a hex string */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Euclidean distance between two RGB colors */
function colorDistance(
  [r1, g1, b1]: [number, number, number],
  [r2, g2, b2]: [number, number, number]
): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Quantize a single channel to 4-bit (16 levels) */
function quantize(value: number): number {
  return Math.round(value / 17) * 17;
}

/**
 * Sample a 5x5 pixel block at the given center position.
 * Returns the most common color in that block.
 */
function sampleBlock(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  blockSize = 5
): [number, number, number] {
  const half = Math.floor(blockSize / 2);
  const counts = new Map<
    string,
    { count: number; rgb: [number, number, number] }
  >();

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = Math.min(Math.max(cx + dx, 0), width - 1);
      const y = Math.min(Math.max(cy + dy, 0), height - 1);
      const i = (y * width + x) * 4;
      const a = data[i + 3];

      // Treat transparent pixels as white
      const r = a === 0 ? 255 : data[i];
      const g = a === 0 ? 255 : data[i + 1];
      const b = a === 0 ? 255 : data[i + 2];

      const key = `${r},${g},${b}`;
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { count: 1, rgb: [r, g, b] });
      }
    }
  }

  let best: [number, number, number] = [255, 255, 255];
  let bestCount = 0;
  for (const { count, rgb } of counts.values()) {
    if (count > bestCount) {
      bestCount = count;
      best = rgb;
    }
  }
  return best;
}

export interface ExtractedColors {
  /** The background/corner color of the image */
  backgroundColor: string;
  /** The most common non-background color */
  dominantColor: string;
}

/**
 * Extract background color and dominant color from an image file.
 *
 * Background: samples 4 corners, picks the most common color.
 * Dominant: quantizes all non-background pixels, returns the most frequent bucket.
 */
export async function extractColorsFromImage(
  file: File | Blob
): Promise<ExtractedColors> {
  const img = await loadImage(file);

  // Use a smaller canvas for performance (max 200px wide)
  const scale = Math.min(1, 200 / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { backgroundColor: '#FFFFFF', dominantColor: '#000000' };
  ctx.drawImage(img, 0, 0, w, h);

  URL.revokeObjectURL(img.src);

  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;

  // --- Background detection: sample 4 corners ---
  const corners: Array<[number, number]> = [
    [2, 2], // top-left
    [w - 3, 2], // top-right
    [2, h - 3], // bottom-left
    [w - 3, h - 3], // bottom-right
  ];

  const cornerColors = corners.map(([cx, cy]) =>
    sampleBlock(data, w, h, cx, cy)
  );

  // Find the most common corner color (group by proximity)
  const cornerCounts: Array<{
    color: [number, number, number];
    count: number;
  }> = [];
  for (const cc of cornerColors) {
    const existing = cornerCounts.find((e) => colorDistance(e.color, cc) < 30);
    if (existing) {
      existing.count++;
    } else {
      cornerCounts.push({ color: cc, count: 1 });
    }
  }
  cornerCounts.sort((a, b) => b.count - a.count);
  const bgRgb = cornerCounts[0].color;
  const backgroundColor = rgbToHex(...bgRgb);

  // --- Dominant color: quantize non-background pixels ---
  const buckets = new Map<
    string,
    { count: number; rgb: [number, number, number] }
  >();
  const totalPixels = w * h;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const a = data[offset + 3];
    if (a < 128) continue; // skip transparent

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];

    // Skip pixels close to the background
    if (colorDistance([r, g, b], bgRgb) < 50) continue;

    // Skip near-white and near-black (not useful as "dominant")
    if (r > 240 && g > 240 && b > 240) continue;
    if (r < 15 && g < 15 && b < 15) continue;

    const qr = quantize(r);
    const qg = quantize(g);
    const qb = quantize(b);
    const key = `${qr},${qg},${qb}`;

    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
    } else {
      buckets.set(key, { count: 1, rgb: [qr, qg, qb] });
    }
  }

  // Pick the most frequent bucket
  let dominantRgb: [number, number, number] = [0, 0, 0];
  let maxCount = 0;
  for (const { count, rgb } of buckets.values()) {
    if (count > maxCount) {
      maxCount = count;
      dominantRgb = rgb;
    }
  }

  const dominantColor = maxCount > 0 ? rgbToHex(...dominantRgb) : '#000000';

  return { backgroundColor, dominantColor };
}
