/**
 * Shared, retrying S3 PUT for presigned-URL uploads.
 *
 * Browser uploads occasionally fail mid-transfer with a network drop or a
 * transient 5xx from S3 (see ENG-345). A single `fetch().then(ok?)` turns
 * those recoverable blips into a hard "upload failed" toast. This helper
 * retries transient failures (network errors and HTTP 5xx) with exponential
 * backoff; 4xx responses fail immediately since retrying won't help.
 *
 * The main image/video upload hook (`upload.hook.ts`) has its own XHR-based
 * variant because it needs progress events; this fetch-based helper is for
 * the chat clip / attachment paths that don't surface a progress bar.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

class RetryableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableUploadError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PUT a file to a presigned S3 URL, retrying transient failures.
 *
 * @param failureMessage Message thrown once retries are exhausted.
 */
export async function putToS3WithRetry(
  url: string,
  file: File,
  failureMessage = 'Upload failed. Check your connection and try again.'
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (response.ok) return;
      if (response.status >= 500) {
        throw new RetryableUploadError(
          `Upload failed with status ${response.status}`
        );
      }
      // 4xx — permanent (bad/expired URL, wrong content-type). Don't retry.
      throw new Error(`Upload failed with status ${response.status}`);
    } catch (error) {
      // fetch() rejects with a TypeError on network failure — treat as
      // retryable alongside our explicit 5xx marker.
      const retryable =
        error instanceof RetryableUploadError || error instanceof TypeError;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!retryable) throw lastError;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
      }
    }
  }

  throw new Error(failureMessage, { cause: lastError ?? undefined });
}
