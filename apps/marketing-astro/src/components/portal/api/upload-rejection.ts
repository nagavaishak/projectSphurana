import {
  PATIENT_DOCUMENT_ACCEPT,
  PATIENT_DOCUMENT_MAX_SIZE_BYTES,
} from './types';

const ACCEPTED_MIME_TYPES = new Set(PATIENT_DOCUMENT_ACCEPT.split(','));

export type UploadRejection =
  | { kind: 'too-large'; fileName: string }
  | { kind: 'wrong-type'; fileName: string };

/**
 * Client-side pre-flight of the server allowlist. The presign endpoint
 * re-validates both rules — this exists only so a customer learns the file is
 * wrong before waiting on an upload, never as the enforcement point.
 */
export function rejectFile(file: {
  name: string;
  size: number;
  type: string;
}): UploadRejection | null {
  if (file.size > PATIENT_DOCUMENT_MAX_SIZE_BYTES) {
    return { kind: 'too-large', fileName: file.name };
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return { kind: 'wrong-type', fileName: file.name };
  }
  return null;
}

export function describeUploadRejection(rejection: UploadRejection): string {
  return rejection.kind === 'too-large'
    ? `${rejection.fileName} is larger than 15MB`
    : `${rejection.fileName} isn't a PDF or a photo`;
}
