import { isFlagEnabled } from '@/components/posthog-provider';
import { apiClient } from '@borradh-workspace/api-client';
import {
  RetryableUploadError,
  backoffWithJitter,
  classifyUploadHttpFailure,
  isRetryableUploadError,
  needsFreshUrl,
  shouldRefreshPresignedUrl,
} from './upload-retry';

/**
 * Gradual-rollout flag gating the resumable multipart upload path.
 * Default OFF → every upload uses the legacy single-PUT presigned path.
 * ON → large files use the resumable multipart path; small files still
 * single-PUT (the multipart threshold is below).
 */
export const RESUMABLE_UPLOADS_FLAG = 'rollout-resumable-uploads';

export type UploadType = 'image' | 'video';
export type UploadPurpose = 'profile' | 'org-asset' | 'patient-document';

export interface PresignedUrlResponse {
  url: string;
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl?: string;
  expiresIn: number;
}

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
  isPublic: boolean;
}

export interface UploadProgressDetail {
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  state: 'uploading' | 'paused' | 'resuming' | 'completing';
  uploadedParts?: number;
  totalParts?: number;
}

export type UploadProgressHandler = (
  progress: number,
  detail?: UploadProgressDetail
) => void;

export interface UploadFileToS3Options {
  onProgress?: UploadProgressHandler;
  resumeNamespace?: string;
  multipartThresholdBytes?: number;
}

interface InitiateMultipartUploadResponse {
  uploadId: string;
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl?: string;
  partSize: number;
  expiresIn: number;
}

interface SignMultipartUploadPartsResponse {
  parts: Array<{
    partNumber: number;
    url: string;
  }>;
  expiresIn: number;
}

interface CompleteMultipartUploadResponse {
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl?: string;
}

interface MultipartUploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

interface MultipartUploadSession {
  uploadId: string;
  key: string;
  bucket: string;
  region: string;
  isPublic: boolean;
  publicUrl?: string;
  partSize: number;
  partCount: number;
  filename: string;
  contentType: string;
  fileSize: number;
  lastModified: number;
  type: UploadType;
  purpose: UploadPurpose;
  parts: MultipartUploadedPart[];
  createdAt: number;
}

export class ResumableUploadError extends Error {
  constructor(
    message: string,
    readonly resumeKey: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ResumableUploadError';
  }
}

const SINGLE_PUT_MAX_ATTEMPTS = 5;
// Base delays for single-PUT jittered backoff. Full-jitter (random in [0, base])
// spreads retries across the window so a short connectivity drop doesn't consume
// every attempt at once, and bursts of clients de-synchronize.
const SINGLE_PUT_RETRY_BASE_DELAYS_MS = [1000, 2000, 4000, 8000];
// Progress-stall watchdog. Safari can leave a PUT socket stalled indefinitely
// (no load/error/abort fires) — but a flat per-attempt timeout also kills
// large files on slow uplinks that ARE making progress. Instead we abort only
// when no bytes have moved for this long; each XHR `progress` event resets
// the timer, so a slow-but-alive upload can run as long as it needs.
const UPLOAD_STALL_TIMEOUT_MS = 60_000;
// Absolute safety-net cap per attempt, in case progress events keep firing
// but the upload can never actually complete.
const UPLOAD_ABSOLUTE_TIMEOUT_MS = 15 * 60_000;
const PART_MAX_ATTEMPTS = 5;
const PART_RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 15_000];
const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 2;
const RESUME_STORAGE_PREFIX = 'borradh:multipart-upload:v1';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFileExtension(filename: string): string {
  return filename.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
}

function getUploadContentType(file: File, type: UploadType): string {
  if (type === 'image') {
    if (
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)
    ) {
      return file.type;
    }
    switch (getFileExtension(file.name)) {
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }

  if (
    ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'].includes(
      file.type
    )
  ) {
    return file.type;
  }
  switch (getFileExtension(file.name)) {
    case 'webm':
      return 'video/webm';
    case 'mov':
    case 'qt':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'video/mp4';
  }
}

async function waitUntilOnline(
  onPaused?: () => void,
  onResuming?: () => void
): Promise<void> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    navigator.onLine !== false
  ) {
    return;
  }

  onPaused?.();
  await new Promise<void>((resolve) => {
    window.addEventListener('online', () => resolve(), { once: true });
  });
  onResuming?.();
}

function isStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const key = `${RESUME_STORAGE_PREFIX}:probe`;
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function buildResumeKey(
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  namespace?: string
): string {
  const scope = namespace ? `${namespace}:` : '';
  return [
    RESUME_STORAGE_PREFIX,
    scope,
    type,
    purpose,
    file.name,
    file.type,
    file.size,
    file.lastModified,
  ].join(':');
}

function readSession(resumeKey: string): MultipartUploadSession | null {
  if (!isStorageAvailable()) return null;
  const raw = window.localStorage.getItem(resumeKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MultipartUploadSession;
  } catch {
    window.localStorage.removeItem(resumeKey);
    return null;
  }
}

function writeSession(resumeKey: string, session: MultipartUploadSession) {
  if (!isStorageAvailable()) return;
  window.localStorage.setItem(resumeKey, JSON.stringify(session));
}

function clearSession(resumeKey: string) {
  if (!isStorageAvailable()) return;
  window.localStorage.removeItem(resumeKey);
}

function sessionMatchesFile(
  session: MultipartUploadSession,
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  contentType: string
): boolean {
  return (
    session.filename === file.name &&
    session.contentType === contentType &&
    session.fileSize === file.size &&
    session.lastModified === file.lastModified &&
    session.type === type &&
    session.purpose === purpose &&
    session.partCount > 0 &&
    session.partSize >= 5 * 1024 * 1024
  );
}

function getPartSize(
  file: File,
  session: MultipartUploadSession,
  partNumber: number
): number {
  const start = (partNumber - 1) * session.partSize;
  const end = Math.min(start + session.partSize, file.size);
  return end - start;
}

function getCompletedBytes(session: MultipartUploadSession): number {
  return session.parts.reduce((sum, part) => sum + part.size, 0);
}

function emitMultipartProgress(
  session: MultipartUploadSession,
  file: File,
  activePartBytes: Map<number, number>,
  state: UploadProgressDetail['state'],
  onProgress?: UploadProgressHandler
) {
  if (!onProgress) return;
  const uploadedBytes =
    getCompletedBytes(session) +
    [...activePartBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const progress =
    state === 'completing'
      ? 99
      : Math.min(99, Math.round((uploadedBytes / file.size) * 100));

  onProgress(progress, {
    progress,
    uploadedBytes,
    totalBytes: file.size,
    state,
    uploadedParts: session.parts.length,
    totalParts: session.partCount,
  });
}

async function getPresignedUploadUrl(
  filename: string,
  contentType: string,
  type: UploadType,
  purpose: UploadPurpose
): Promise<PresignedUrlResponse> {
  return apiClient.post<PresignedUrlResponse>('upload/presigned-url', {
    filename,
    contentType,
    type,
    purpose,
  });
}

async function initiateMultipartUpload(
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  partSize: number,
  contentType: string
): Promise<InitiateMultipartUploadResponse> {
  return apiClient.post<InitiateMultipartUploadResponse>(
    'upload/multipart/initiate',
    {
      filename: file.name,
      contentType,
      type,
      purpose,
      partSize,
    }
  );
}

async function signMultipartUploadPart(
  session: MultipartUploadSession,
  partNumber: number
): Promise<string> {
  const response = await apiClient.post<SignMultipartUploadPartsResponse>(
    'upload/multipart/sign-parts',
    {
      key: session.key,
      uploadId: session.uploadId,
      type: session.type,
      purpose: session.purpose,
      partNumbers: [partNumber],
    }
  );
  const part = response.parts.find((item) => item.partNumber === partNumber);
  if (!part) throw new Error(`Missing signed URL for part ${partNumber}`);
  return part.url;
}

async function completeMultipartUpload(
  session: MultipartUploadSession
): Promise<CompleteMultipartUploadResponse> {
  return apiClient.post<CompleteMultipartUploadResponse>(
    'upload/multipart/complete',
    {
      key: session.key,
      uploadId: session.uploadId,
      type: session.type,
      purpose: session.purpose,
      parts: session.parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
      })),
    }
  );
}

async function putWithProgress(
  url: string,
  body: Blob,
  options: {
    contentType?: string;
    onProgress?: (loaded: number, total: number) => void;
  } = {}
): Promise<{ etag?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Stall watchdog: abort only when no bytes have moved for
    // UPLOAD_STALL_TIMEOUT_MS. Every progress event re-arms the timer, so a
    // slow-but-progressing upload never gets killed. An absolute cap remains
    // as a safety net against a permanently-looping transfer.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdogError: Error | null = null;

    const abortWith = (error: Error) => {
      watchdogError = error;
      xhr.abort();
    };
    const absoluteTimer = setTimeout(
      () =>
        abortWith(
          new RetryableUploadError(
            `Upload exceeded the ${Math.round(UPLOAD_ABSOLUTE_TIMEOUT_MS / 60_000)} minute limit`
          )
        ),
      UPLOAD_ABSOLUTE_TIMEOUT_MS
    );
    const clearTimers = () => {
      clearTimeout(stallTimer);
      clearTimeout(absoluteTimer);
    };
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () =>
          abortWith(
            new RetryableUploadError(
              `Upload stalled: no progress for ${Math.round(UPLOAD_STALL_TIMEOUT_MS / 1000)}s`
            )
          ),
        UPLOAD_STALL_TIMEOUT_MS
      );
    };

    xhr.upload.addEventListener('progress', (event) => {
      armStallTimer();
      if (event.lengthComputable) {
        options.onProgress?.(event.loaded, event.total);
      }
    });

    xhr.addEventListener('load', () => {
      clearTimers();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') ?? undefined });
      } else {
        reject(classifyUploadHttpFailure(xhr.status));
      }
    });

    xhr.addEventListener('error', () => {
      clearTimers();
      reject(new RetryableUploadError('Upload failed due to a network error'));
    });

    xhr.addEventListener('abort', () => {
      clearTimers();
      reject(watchdogError ?? new Error('Upload aborted'));
    });

    xhr.open('PUT', url);
    if (options.contentType) {
      xhr.setRequestHeader('Content-Type', options.contentType);
    }
    armStallTimer();
    xhr.send(body);
  });
}

/**
 * PUT a file to S3 with retries. The presigned URL comes from `getUrl` so it
 * can be refreshed mid-retry: a 403 means the URL went stale (expired TTL),
 * and the next attempt calls `getUrl(true)` to force a fresh presign instead
 * of burning the remaining attempts on a URL that can never succeed.
 */
async function putObjectToS3(
  file: File,
  getUrl: (forceRefresh?: boolean) => Promise<string>,
  onProgress?: UploadProgressHandler,
  contentType = file.type
): Promise<void> {
  onProgress?.(0, {
    progress: 0,
    uploadedBytes: 0,
    totalBytes: file.size,
    state: 'uploading',
  });

  let lastError: Error | null = null;
  let refreshUrl = false;
  for (let attempt = 1; attempt <= SINGLE_PUT_MAX_ATTEMPTS; attempt++) {
    try {
      await waitUntilOnline(
        () =>
          onProgress?.(0, {
            progress: 0,
            uploadedBytes: 0,
            totalBytes: file.size,
            state: 'paused',
          }),
        () =>
          onProgress?.(0, {
            progress: 0,
            uploadedBytes: 0,
            totalBytes: file.size,
            state: 'resuming',
          })
      );
      const url = await getUrl(refreshUrl);
      refreshUrl = false;
      await putWithProgress(url, file, {
        contentType,
        onProgress: (loaded) => {
          const progress = Math.round((loaded / file.size) * 100);
          onProgress?.(progress, {
            progress,
            uploadedBytes: loaded,
            totalBytes: file.size,
            state: 'uploading',
          });
        },
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (
        !isRetryableUploadError(error) ||
        attempt === SINGLE_PUT_MAX_ATTEMPTS
      ) {
        break;
      }
      // 403 → the presigned URL went stale; fetch a fresh one for the next
      // attempt (within the same attempt budget — no extra attempts).
      refreshUrl = needsFreshUrl(error);
      await sleep(backoffWithJitter(attempt, SINGLE_PUT_RETRY_BASE_DELAYS_MS));
    }
  }

  throw new Error(
    `Upload failed after ${SINGLE_PUT_MAX_ATTEMPTS} attempts (${lastError?.message ?? 'unknown error'}). Check your connection and try again.`,
    { cause: lastError ?? undefined }
  );
}

async function ensureMultipartSession(
  resumeKey: string,
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  contentType: string
): Promise<MultipartUploadSession> {
  const existing = readSession(resumeKey);
  if (
    existing &&
    sessionMatchesFile(existing, file, type, purpose, contentType)
  ) {
    return existing;
  }

  const partSize = Math.max(
    DEFAULT_PART_SIZE_BYTES,
    Math.ceil(file.size / 10_000)
  );
  const initiated = await initiateMultipartUpload(
    file,
    type,
    purpose,
    partSize,
    contentType
  );
  const session: MultipartUploadSession = {
    uploadId: initiated.uploadId,
    key: initiated.key,
    bucket: initiated.bucket,
    region: initiated.region,
    isPublic: initiated.isPublic,
    publicUrl: initiated.publicUrl,
    partSize: initiated.partSize,
    partCount: Math.ceil(file.size / initiated.partSize),
    filename: file.name,
    contentType,
    fileSize: file.size,
    lastModified: file.lastModified,
    type,
    purpose,
    parts: [],
    createdAt: Date.now(),
  };
  writeSession(resumeKey, session);
  return session;
}

async function uploadMultipartPart(
  file: File,
  session: MultipartUploadSession,
  resumeKey: string,
  partNumber: number,
  activePartBytes: Map<number, number>,
  onProgress?: UploadProgressHandler
): Promise<void> {
  const start = (partNumber - 1) * session.partSize;
  const end = Math.min(start + session.partSize, file.size);
  const partBlob = file.slice(start, end);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
    try {
      await waitUntilOnline(
        () =>
          emitMultipartProgress(
            session,
            file,
            activePartBytes,
            'paused',
            onProgress
          ),
        () =>
          emitMultipartProgress(
            session,
            file,
            activePartBytes,
            'resuming',
            onProgress
          )
      );
      const url = await signMultipartUploadPart(session, partNumber);
      const result = await putWithProgress(url, partBlob, {
        onProgress: (loaded) => {
          activePartBytes.set(partNumber, loaded);
          emitMultipartProgress(
            session,
            file,
            activePartBytes,
            'uploading',
            onProgress
          );
        },
      });
      if (!result.etag) {
        throw new Error(
          'Upload part completed but S3 did not expose an ETag header.'
        );
      }

      activePartBytes.delete(partNumber);
      session.parts = [
        ...session.parts.filter((part) => part.partNumber !== partNumber),
        {
          partNumber,
          etag: result.etag,
          size: getPartSize(file, session, partNumber),
        },
      ].sort((a, b) => a.partNumber - b.partNumber);
      writeSession(resumeKey, session);
      emitMultipartProgress(
        session,
        file,
        activePartBytes,
        'uploading',
        onProgress
      );
      return;
    } catch (error) {
      activePartBytes.delete(partNumber);
      lastError = error instanceof Error ? error : new Error(String(error));
      // Note: a stale-URL 403 is retryable here too — each part attempt
      // re-signs its URL via signMultipartUploadPart above.
      if (!isRetryableUploadError(error) || attempt === PART_MAX_ATTEMPTS) {
        break;
      }
      await sleep(PART_RETRY_DELAYS_MS[attempt - 1] ?? 15_000);
    }
  }

  throw new ResumableUploadError(
    'Upload paused. Tap Resume when your connection is back.',
    resumeKey,
    { cause: lastError ?? undefined }
  );
}

async function uploadMultipartToS3(
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  options: UploadFileToS3Options
): Promise<UploadResult> {
  const contentType = getUploadContentType(file, type);
  const resumeKey = buildResumeKey(
    file,
    type,
    purpose,
    options.resumeNamespace
  );
  const session = await ensureMultipartSession(
    resumeKey,
    file,
    type,
    purpose,
    contentType
  );
  const activePartBytes = new Map<number, number>();

  emitMultipartProgress(
    session,
    file,
    activePartBytes,
    session.parts.length > 0 ? 'resuming' : 'uploading',
    options.onProgress
  );

  const uploadedPartNumbers = new Set(
    session.parts.map((part) => part.partNumber)
  );
  const missingPartNumbers = Array.from(
    { length: session.partCount },
    (_, index) => index + 1
  ).filter((partNumber) => !uploadedPartNumbers.has(partNumber));

  let nextIndex = 0;
  let uploadError: unknown = null;
  async function worker() {
    while (!uploadError && nextIndex < missingPartNumbers.length) {
      const partNumber = missingPartNumbers[nextIndex];
      nextIndex++;
      try {
        await uploadMultipartPart(
          file,
          session,
          resumeKey,
          partNumber,
          activePartBytes,
          options.onProgress
        );
      } catch (error) {
        uploadError = error;
      }
    }
  }

  const workerCount = Math.min(
    MULTIPART_CONCURRENCY,
    missingPartNumbers.length
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (uploadError) throw uploadError;

  emitMultipartProgress(
    session,
    file,
    activePartBytes,
    'completing',
    options.onProgress
  );
  let result: CompleteMultipartUploadResponse;
  try {
    result = await completeMultipartUpload(session);
  } catch (error) {
    throw new ResumableUploadError(
      'Upload parts are saved. Tap Resume to finish.',
      resumeKey,
      { cause: error instanceof Error ? error : new Error(String(error)) }
    );
  }
  clearSession(resumeKey);
  options.onProgress?.(100, {
    progress: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    state: 'completing',
    uploadedParts: session.partCount,
    totalParts: session.partCount,
  });

  return {
    key: result.key,
    url:
      result.publicUrl ??
      `https://${result.bucket}.s3.${result.region}.amazonaws.com/${result.key}`,
    bucket: result.bucket,
    isPublic: result.isPublic,
  };
}

async function uploadSinglePutToS3(
  file: File,
  type: UploadType,
  purpose: UploadPurpose,
  onProgress?: UploadProgressHandler
): Promise<UploadResult> {
  const contentType = getUploadContentType(file, type);
  // Presign provider with caching: the first attempt presigns once; retries
  // reuse the cached URL unless (a) the previous attempt failed with 403
  // (forceRefresh), or (b) the cached URL is within 60s of its expiresIn TTL
  // (backoff + slow attempts can outlive it). Each presign call may generate
  // a NEW S3 key, so the final result must come from the presign that the
  // successful PUT actually used — i.e. the last cached response.
  let cached: { response: PresignedUrlResponse; issuedAtMs: number } | null =
    null;
  const getUrl = async (forceRefresh = false): Promise<string> => {
    if (
      !cached ||
      forceRefresh ||
      shouldRefreshPresignedUrl(cached.issuedAtMs, cached.response.expiresIn)
    ) {
      const issuedAtMs = Date.now();
      const response = await getPresignedUploadUrl(
        file.name,
        contentType,
        type,
        purpose
      );
      cached = { response, issuedAtMs };
    }
    return cached.response.url;
  };

  await putObjectToS3(file, getUrl, onProgress, contentType);

  if (!cached) {
    // Unreachable: putObjectToS3 only resolves after a successful PUT, which
    // requires getUrl to have populated the cache.
    throw new Error('Upload completed without a presigned URL');
  }
  const { key, bucket, region, isPublic, publicUrl } = (
    cached as { response: PresignedUrlResponse }
  ).response;

  return {
    key,
    url: publicUrl ?? `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    bucket,
    isPublic,
  };
}

export async function uploadFileToS3(
  file: File,
  type: UploadType,
  purpose: UploadPurpose = 'org-asset',
  options: UploadFileToS3Options = {}
): Promise<UploadResult> {
  // Default-OFF gradual rollout. When the flag is off (or flags have not
  // loaded yet), always take the legacy single-PUT presigned path — the safe
  // fallback. Only when the flag is on for this user/org do large files use
  // the resumable multipart path.
  const resumableEnabled = isFlagEnabled(RESUMABLE_UPLOADS_FLAG);

  const threshold =
    options.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES;

  if (resumableEnabled && file.size >= threshold) {
    return uploadMultipartToS3(file, type, purpose, options);
  }

  return uploadSinglePutToS3(file, type, purpose, options.onProgress);
}
