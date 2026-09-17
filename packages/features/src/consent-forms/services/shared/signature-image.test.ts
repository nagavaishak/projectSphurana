import { describe, expect, it } from '@borradh-workspace/testing';
import { decodeSignatureImage } from './signature-image.js';

const MAX = 200_000;
const PREFIX = 'data:image/png;base64,';

/** A minimal, structurally valid PNG header: magic + IHDR with real dims. */
const pngBytes = (width = 300, height = 120): Buffer => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

const asDataUrl = (bytes: Buffer) => PREFIX + bytes.toString('base64');

/**
 * The failure this guards against is not a rejected upload — it is an ACCEPTED
 * one. A prefix check plus a size cap let any payload through, because
 * `Buffer.from(x, 'base64')` discards invalid characters instead of throwing.
 * The PDF renderer then sniffed the bytes, found no PNG, omitted the image and
 * carried on: a consent form stating the patient signed, with nothing where
 * the signature belongs, marked completed, nothing logged.
 *
 * Every rejection below used to be a silently signature-less legal document.
 */
describe('decodeSignatureImage', () => {
  it('accepts a real PNG and reports its dimensions', () => {
    const result = decodeSignatureImage(asDataUrl(pngBytes(400, 150)), MAX);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(400);
      expect(result.height).toBe(150);
      expect(result.bytes.length).toBeGreaterThan(0);
    }
  });

  it('rejects a JPEG wearing a PNG data-URL prefix', () => {
    // JPEG SOI + APP0, padded past the minimum length so only the magic
    // distinguishes it — exactly what a mislabelled canvas export looks like.
    const jpeg = Buffer.alloc(40);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(jpeg, 0);

    expect(decodeSignatureImage(asDataUrl(jpeg), MAX).ok).toBe(false);
  });

  it('rejects an SVG wearing a PNG data-URL prefix', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    expect(decodeSignatureImage(asDataUrl(svg), MAX).ok).toBe(false);
  });

  it('rejects random bytes', () => {
    const noise = Buffer.alloc(64, 0x5a);

    expect(decodeSignatureImage(asDataUrl(noise), MAX).ok).toBe(false);
  });

  it('rejects a payload outside the base64 alphabet instead of silently dropping it', () => {
    // This is the mechanism behind the whole bug: Buffer.from would discard
    // the `!!!!` and hand back a shorter, corrupt buffer that still decodes.
    const corrupt = `${PREFIX}${pngBytes().toString('base64')}!!!!`;

    expect(decodeSignatureImage(corrupt, MAX).ok).toBe(false);
  });

  it('rejects PNG magic with no IHDR behind it', () => {
    const truncated = Buffer.alloc(30);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      truncated,
      0
    );

    expect(decodeSignatureImage(asDataUrl(truncated), MAX).ok).toBe(false);
  });

  it('rejects a zero-dimension image', () => {
    expect(decodeSignatureImage(asDataUrl(pngBytes(0, 120)), MAX).ok).toBe(
      false
    );
  });

  it('rejects absurd dimensions', () => {
    expect(decodeSignatureImage(asDataUrl(pngBytes(99_999, 10)), MAX).ok).toBe(
      false
    );
  });

  it('rejects a payload over the byte cap', () => {
    const result = decodeSignatureImage(asDataUrl(pngBytes()), 10);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too large/i);
  });

  it('rejects an empty payload', () => {
    expect(decodeSignatureImage(PREFIX, MAX).ok).toBe(false);
  });

  it('rejects a non-PNG data URL outright', () => {
    const jpegUrl = `data:image/jpeg;base64,${pngBytes().toString('base64')}`;

    expect(decodeSignatureImage(jpegUrl, MAX).ok).toBe(false);
  });

  it('gives the person at the signature pad something actionable', () => {
    const result = decodeSignatureImage(asDataUrl(Buffer.alloc(64, 1)), MAX);

    expect(result.ok).toBe(false);
    // Not a description of the PNG header — they are standing at a pad.
    if (!result.ok) expect(result.reason).toMatch(/sign again/i);
  });
});
