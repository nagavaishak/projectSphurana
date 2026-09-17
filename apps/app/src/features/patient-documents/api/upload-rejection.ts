import {
  PATIENT_DOCUMENT_ACCEPT,
  PATIENT_DOCUMENT_MAX_SIZE_BYTES,
} from './types';

/** Names customers recognise, for mime types they don't. */
const FRIENDLY_TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/heic': 'HEIC',
  'image/webp': 'WebP',
};

/**
 * Human-readable file types, derived from the allow-list so the copy can never
 * drift from what is actually accepted.
 *
 * Built from the mime keys rather than the extensions: the extension list
 * carries both `.jpg` and `.jpeg`, and "JPG, JPEG" reads as two formats when
 * it is one. A type with no friendly name falls back to its subtype, so adding
 * one to the allow-list degrades to something readable rather than vanishing.
 */
const ALLOWED_LABELS = [
  ...new Set(
    Object.keys(PATIENT_DOCUMENT_ACCEPT).map(
      (mime) => FRIENDLY_TYPE_NAMES[mime] ?? mime.split('/')[1].toUpperCase()
    )
  ),
];

/** "PDF, JPG, JPEG, PNG, HEIC or WEBP" */
function listAllowed(): string {
  if (ALLOWED_LABELS.length <= 1) return ALLOWED_LABELS[0] ?? '';
  const head = ALLOWED_LABELS.slice(0, -1).join(', ');
  return `${head} or ${ALLOWED_LABELS[ALLOWED_LABELS.length - 1]}`;
}

const MAX_SIZE_MB = Math.round(PATIENT_DOCUMENT_MAX_SIZE_BYTES / (1024 * 1024));

/**
 * Turn a react-dropzone rejection into something a customer can act on.
 *
 * Dropzone's own message is the raw `accept` attribute — a patient trying to
 * upload a photo was told "File type must be one of application/pdf, .pdf,
 * image/jpeg, .jpg, .jpeg, image/png, .png, image/heic, .heic, image/webp,
 * .webp". That is a spec, not an instruction, and it is shown on the customer
 * side of the product.
 *
 * Matched on the message rather than a code because the Dropzone `onError`
 * contract only gives us an `Error`.
 */
export function describeUploadRejection(error: Error): string {
  const message = error.message ?? '';

  if (/file type|accept/i.test(message)) {
    return `That file type isn't supported — please upload a ${listAllowed()} file.`;
  }

  if (/larger|too large|size|maxSize/i.test(message)) {
    return `That file is too large — the limit is ${MAX_SIZE_MB}MB.`;
  }

  if (/too many|maxFiles/i.test(message)) {
    return 'Too many files at once — please add up to 5 at a time.';
  }

  return 'That file cannot be uploaded.';
}
