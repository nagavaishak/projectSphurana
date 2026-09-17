import { apiClient } from '@borradh-workspace/api-client';

/**
 * Auth-free upload path for the magic-link record hand-off. The upload token
 * (minted by the authed desktop, carried in the QR) authorizes these calls, so
 * the phone never needs a session. Endpoints are `@Public()` on the API.
 */

export interface VerifyMobileTokenResult {
  uploadUrl: string;
  key: string;
  contentType: string;
  videoId: string;
  /** Teleprompter script, so the auth-free screen can render without a video fetch. */
  scriptText?: string;
}

/** Resolve the token → fresh presigned S3 PUT URL + the teleprompter script. */
export function verifyMobileUploadToken(token: string) {
  return apiClient.get<VerifyMobileTokenResult>(
    `upload/mobile-verify/${token}`
  );
}

/**
 * Raw presigned PUT to S3 with progress. The presign is signed for `video/mp4`,
 * so the request MUST send exactly that Content-Type or S3 rejects the
 * signature — the object is labelled mp4 even when the phone recorded webm.
 */
export function putRecordingToS3(
  uploadUrl: string,
  file: Blob,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('Upload failed due to a network error'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.send(file);
  });
}
