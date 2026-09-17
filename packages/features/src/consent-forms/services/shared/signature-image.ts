/**
 * Validating the drawn signature on a consent form.
 *
 * The only checks this replaces were a zod regex on the data-URL PREFIX and a
 * decoded-size cap. Neither looks at the bytes, and `Buffer.from(x, 'base64')`
 * silently DISCARDS characters outside the base64 alphabet rather than
 * throwing — so any payload at all decoded to "something" and was stored as
 * `image/png`.
 *
 * The consequence was not a failed upload. `tryEmbedImage` in
 * generate-consent-pdf sniffs the real bytes, finds no PNG, and returns null
 * while the compose continues — producing a PDF that states the patient
 * signed, with a blank space where the signature belongs, on a submission
 * marked `completed`, with nothing logged anywhere.
 *
 * For a legal instrument that is the worst possible failure direction: the
 * system asserts something untrue, and whoever relies on that PDF in a
 * complaint finds out at the worst moment. A signature that fails to capture
 * is recoverable; one that silently goes missing is not. So: reject here, and
 * leave the submission `pending` so the patient can sign again.
 */

/** PNG signature — the first 8 bytes of every PNG file (RFC 2083 §3.1). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR is required to be the FIRST chunk, so its offsets are fixed. */
const IHDR_TYPE_OFFSET = 12;
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;
/** magic(8) + length(4) + type(4) + width(4) + height(4) */
const MIN_PNG_BYTES = 24;

/**
 * Generous upper bound on a signature canvas. Not a security control — the
 * byte cap is — just a guard against a decoded blob that claims absurd
 * dimensions, which is a sign it is not the signature pad's output.
 */
const MAX_DIMENSION = 8000;

/** Base64 alphabet plus padding, and nothing else. */
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const DATA_URL_PREFIX = 'data:image/png;base64,';

export type SignatureDecodeResult =
  | { ok: true; bytes: Buffer; width: number; height: number }
  | { ok: false; reason: string };

/**
 * Decode and VERIFY a drawn signature.
 *
 * `reason` is customer-facing: the person is standing at a signature pad, and
 * "that didn't save, please sign again" is more use to them than a description
 * of the PNG header.
 */
export const decodeSignatureImage = (
  dataUrl: string,
  maxBytes: number
): SignatureDecodeResult => {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    return {
      ok: false,
      reason: 'Please draw your signature to sign this form',
    };
  }

  const payload = dataUrl.slice(DATA_URL_PREFIX.length);
  if (payload.length === 0) {
    return {
      ok: false,
      reason: 'Please draw your signature to sign this form',
    };
  }

  // Reject before decoding. Buffer.from would quietly drop the offending
  // characters and hand back a shorter, corrupt buffer that still "looks"
  // decoded — which is how a non-PNG payload got this far in the first place.
  if (!STRICT_BASE64.test(payload)) {
    return {
      ok: false,
      reason: "That signature didn't save correctly — please sign again",
    };
  }

  const bytes = Buffer.from(payload, 'base64');

  if (bytes.length === 0) {
    return {
      ok: false,
      reason: 'Please draw your signature to sign this form',
    };
  }
  // Size first: cheapest check, and it bounds everything below it.
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      reason: 'That signature image is too large — please try again',
    };
  }
  if (bytes.length < MIN_PNG_BYTES) {
    return {
      ok: false,
      reason: "That signature didn't save correctly — please sign again",
    };
  }

  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return {
      ok: false,
      reason: "That signature didn't save correctly — please sign again",
    };
  }

  // A file can carry the PNG magic and still be truncated garbage. IHDR is
  // mandatory and must come first, so its absence means this is not a PNG we
  // can render — which is exactly the case that used to produce a signed PDF
  // with no signature in it.
  if (
    bytes.toString('ascii', IHDR_TYPE_OFFSET, IHDR_TYPE_OFFSET + 4) !== 'IHDR'
  ) {
    return {
      ok: false,
      reason: "That signature didn't save correctly — please sign again",
    };
  }

  const width = bytes.readUInt32BE(IHDR_WIDTH_OFFSET);
  const height = bytes.readUInt32BE(IHDR_HEIGHT_OFFSET);
  if (
    width === 0 ||
    height === 0 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return {
      ok: false,
      reason: "That signature didn't save correctly — please sign again",
    };
  }

  return { ok: true, bytes, width, height };
};
