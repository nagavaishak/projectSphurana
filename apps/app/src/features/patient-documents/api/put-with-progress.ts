/**
 * Single-PUT S3 upload with progress events (ENG-647 Phase 4).
 *
 * The document vault deliberately skips the resumable multipart machinery —
 * files are capped at 15MB, so a plain XHR PUT (fetch has no upload
 * progress) with a couple of retries on transient failures is enough.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 2000];

class RetryablePutError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function putOnce(
  url: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status >= 500) {
        reject(
          new RetryablePutError(`Upload failed with status ${xhr.status}`)
        );
      } else {
        // 4xx — bad/expired URL or wrong content type; retrying won't help.
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () =>
      reject(new RetryablePutError('Upload failed due to a network error'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

export async function putFileWithProgress(
  url: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await putOnce(url, file, onProgress);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!(error instanceof RetryablePutError) || attempt === MAX_ATTEMPTS) {
        break;
      }
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 2000);
    }
  }

  throw new Error('Upload failed. Check your connection and try again.', {
    cause: lastError ?? undefined,
  });
}
