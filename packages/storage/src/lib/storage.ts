import type { Readable } from 'node:stream';
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ObjectCannedACL,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageEnv } from '@borradh-workspace/env/storage';
import { fetchWithRetry } from '@borradh-workspace/http';
import { getDefaultBucket, getS3Client } from './s3-client.js';

export interface UploadOptions {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string | ReadableStream | Readable;
  contentType?: string;
  /**
   * Required when `body` is a Node Readable stream: S3 PutObject needs a
   * Content-Length up front for unbuffered stream bodies (use
   * `fs.statSync(path).size` for file streams).
   */
  contentLength?: number;
  metadata?: Record<string, string>;
  acl?: ObjectCannedACL;
}

export interface DownloadOptions {
  bucket?: string;
  key: string;
}

export interface DeleteOptions {
  bucket?: string;
  key: string;
}

export interface ListOptions {
  bucket?: string;
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface CopyOptions {
  sourceBucket?: string;
  sourceKey: string;
  destinationBucket?: string;
  destinationKey: string;
}

export interface PresignedUrlOptions {
  bucket?: string;
  key: string;
  expiresIn?: number; // seconds, default 3600
}

export interface CreateMultipartUploadOptions {
  bucket?: string;
  key: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface PresignedMultipartPartUrlOptions {
  bucket?: string;
  key: string;
  uploadId: string;
  partNumber: number;
  expiresIn?: number;
}

export interface CompleteMultipartUploadOptions {
  bucket?: string;
  key: string;
  uploadId: string;
  parts: Array<{
    partNumber: number;
    etag: string;
  }>;
}

export interface ObjectMetadata {
  key: string;
  size?: number;
  lastModified?: Date;
  contentType?: string;
  metadata?: Record<string, string>;
  etag?: string;
}

export interface ListResult {
  objects: ObjectMetadata[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export async function upload(
  options: UploadOptions
): Promise<{ etag?: string; versionId?: string }> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    Body: options.body,
    ContentLength: options.contentLength,
    ContentType: options.contentType,
    Metadata: options.metadata,
    ACL: options.acl,
  });

  const response = await client.send(command);
  return {
    etag: response.ETag,
    versionId: response.VersionId,
  };
}

export async function download(options: DownloadOptions): Promise<{
  body: ReadableStream | null;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  const response = await client.send(command);
  return {
    body: response.Body?.transformToWebStream() ?? null,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    metadata: response.Metadata,
  };
}

export async function downloadAsBuffer(
  options: DownloadOptions
): Promise<Buffer> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  const response = await client.send(command);
  const bytes = await response.Body?.transformToByteArray();
  return Buffer.from(bytes ?? []);
}

export async function downloadAsString(
  options: DownloadOptions
): Promise<string> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  const response = await client.send(command);
  return (await response.Body?.transformToString()) ?? '';
}

export async function deleteObject(options: DeleteOptions): Promise<void> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  await client.send(command);
}

export async function exists(options: DownloadOptions): Promise<boolean> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  try {
    await client.send(command);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

export async function getMetadata(
  options: DownloadOptions
): Promise<ObjectMetadata | null> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: options.key,
  });

  try {
    const response = await client.send(command);
    return {
      key: options.key,
      size: response.ContentLength,
      lastModified: response.LastModified,
      contentType: response.ContentType,
      metadata: response.Metadata,
      etag: response.ETag,
    };
  } catch (error) {
    if ((error as { name?: string }).name === 'NotFound') {
      return null;
    }
    throw error;
  }
}

export async function list(options: ListOptions = {}): Promise<ListResult> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: options.prefix,
    MaxKeys: options.maxKeys,
    ContinuationToken: options.continuationToken,
  });

  const response = await client.send(command);

  const objects: ObjectMetadata[] =
    response.Contents?.map((obj) => ({
      key: obj.Key ?? '',
      size: obj.Size,
      lastModified: obj.LastModified,
      etag: obj.ETag,
    })) ?? [];

  return {
    objects,
    isTruncated: response.IsTruncated ?? false,
    nextContinuationToken: response.NextContinuationToken,
  };
}

/**
 * Copy an object from a bucket in ANOTHER AWS ACCOUNT, authenticating against
 * the source with a separate named profile.
 *
 * `copy()` issues a server-side CopyObject, which is faster and never moves
 * bytes through this process — but S3 performs it with the CALLER's
 * credentials, so it only works when the caller already holds s3:GetObject on
 * the source. When no such grant exists (and creating one is a cross-account
 * infra change), this pulls the object down with the source account's own
 * credentials and pushes it back up with ours.
 *
 * Prefer `copy()` wherever the grant exists. This exists for one-off promotions
 * and for bootstrapping an environment before any trust relationship is set up.
 *
 * NOTE: the object is buffered in memory, so call this sequentially rather than
 * fanning out across a large bank.
 */
export async function copyFromForeignAccount(options: {
  sourceProfile: string;
  sourceBucket: string;
  sourceKey: string;
  bucket?: string;
  key: string;
  contentType?: string;
}): Promise<{ etag?: string }> {
  const source = new S3Client({
    region: storageEnv.S3_REGION,
    credentials: fromNodeProviderChain({ profile: options.sourceProfile }),
  });

  try {
    const got = await source.send(
      new GetObjectCommand({
        Bucket: options.sourceBucket,
        Key: options.sourceKey,
      })
    );

    if (!got.Body) {
      throw new Error(
        `empty body for s3://${options.sourceBucket}/${options.sourceKey}`
      );
    }

    const bytes = await got.Body.transformToByteArray();

    return upload({
      bucket: options.bucket,
      key: options.key,
      body: Buffer.from(bytes),
      contentType:
        options.contentType ?? got.ContentType ?? 'application/octet-stream',
    });
  } finally {
    source.destroy();
  }
}

export async function copy(options: CopyOptions): Promise<{ etag?: string }> {
  const client = getS3Client();
  const sourceBucket = options.sourceBucket ?? getDefaultBucket();
  const destinationBucket = options.destinationBucket ?? getDefaultBucket();

  const command = new CopyObjectCommand({
    Bucket: destinationBucket,
    Key: options.destinationKey,
    CopySource: `${sourceBucket}/${options.sourceKey}`,
  });

  const response = await client.send(command);
  return {
    etag: response.CopyObjectResult?.ETag,
  };
}

export async function getPresignedDownloadUrl(
  options: PresignedUrlOptions & {
    /**
     * Override the Content-Type S3 returns, regardless of what was stored on
     * the object. For any bucket that holds end-user-uploaded bytes (patient
     * documents, avatars, etc.), pass a safe value so an attacker who stored
     * `text/html` can't get it served inline and executed as stored XSS when
     * the presigned URL is opened in a browser tab.
     */
    responseContentType?: string;
    /**
     * Override the Content-Disposition. Pass `attachment; filename="..."` for
     * user-uploaded content so the browser downloads rather than renders it —
     * the strongest single mitigation against stored XSS via object content.
     */
    responseContentDisposition?: string;
  }
): Promise<string> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ResponseContentType: options.responseContentType,
    ResponseContentDisposition: options.responseContentDisposition,
  });

  return getSignedUrl(client, command, {
    expiresIn: options.expiresIn ?? 3600,
  });
}

/**
 * RFC 6266 / 5987 Content-Disposition value that forces a browser download and
 * carries the original filename safely. The filename is stripped of characters
 * that could break out of the header (CR/LF/quote/backslash/control) — a
 * user-controlled filename must never be able to inject a second header or a
 * second disposition directive.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
    .replace(/[\r\n"\\\x00-\x1f\x7f]/g, '_')
    .slice(0, 255);
  const safeAscii = ascii.length > 0 ? ascii : 'download';
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

export async function getPresignedUploadUrl(
  options: PresignedUrlOptions & {
    contentType?: string;
    /**
     * Bind the upload to an exact byte count.
     *
     * Without this, a presigned PUT signs only Bucket/Key/ContentType, so any
     * size limit the caller validated is advisory — the holder of the URL can
     * declare 1 KB and then PUT gigabytes. Passing it adds `content-length` to
     * the signed headers, so S3 rejects any PUT whose Content-Length differs
     * from what was signed. Optional: callers that genuinely don't know the
     * size ahead of time (multipart, server-side copies) omit it.
     */
    contentLength?: number;
  }
): Promise<string> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ContentType: options.contentType,
    ...(options.contentLength !== undefined
      ? { ContentLength: options.contentLength }
      : {}),
  });

  // Explicitly SIGN the headers we constrain, so S3 rejects any PUT that
  // deviates. `content-length` binds the size (see the doc comment above).
  // `content-type` binds the declared MIME type: setting `ContentType` on the
  // command alone is NOT reliably enough — whether the v3 presigner folds it
  // into `X-Amz-SignedHeaders` by default is version-dependent, so we force it.
  // Without this, an allowlist checked against the client-declared type at
  // presign time is advisory: the holder of a `image/png`-presigned URL could
  // PUT `text/html` bytes, which then serve inline as stored XSS. Signing it
  // makes S3 reject the mismatched PUT outright.
  const signableHeaders = new Set<string>();
  if (options.contentLength !== undefined)
    signableHeaders.add('content-length');
  if (options.contentType !== undefined) signableHeaders.add('content-type');

  return getSignedUrl(client, command, {
    expiresIn: options.expiresIn ?? 3600,
    ...(signableHeaders.size > 0 ? { signableHeaders } : {}),
  });
}

export async function createMultipartUpload(
  options: CreateMultipartUploadOptions
): Promise<{ uploadId: string }> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: options.key,
    ContentType: options.contentType,
    Metadata: options.metadata,
  });

  const response = await client.send(command);
  if (!response.UploadId) {
    throw new Error('S3 did not return a multipart upload id');
  }
  return { uploadId: response.UploadId };
}

export async function getPresignedMultipartUploadPartUrl(
  options: PresignedMultipartPartUrlOptions
): Promise<string> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();

  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: options.key,
    UploadId: options.uploadId,
    PartNumber: options.partNumber,
  });

  return getSignedUrl(client, command, {
    expiresIn: options.expiresIn ?? 3600,
  });
}

export async function completeMultipartUpload(
  options: CompleteMultipartUploadOptions
): Promise<{ etag?: string; location?: string; versionId?: string }> {
  const client = getS3Client();
  const bucket = options.bucket ?? getDefaultBucket();
  const parts = [...options.parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => ({
      ETag: part.etag,
      PartNumber: part.partNumber,
    }));

  const command = new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: options.key,
    UploadId: options.uploadId,
    MultipartUpload: { Parts: parts },
  });

  const response = await client.send(command);
  return {
    etag: response.ETag,
    location: response.Location,
    versionId: response.VersionId,
  };
}

export interface CopyFromUrlOptions {
  /** Source URL to download from (can be presigned S3 URL or any HTTP URL) */
  sourceUrl: string;
  /** Destination bucket */
  bucket: string;
  /** Destination key in the bucket */
  key: string;
  /** Content type (auto-detected if not provided) */
  contentType?: string;
  /**
   * Per-attempt download timeout in ms. Defaults to 60s — generous because the
   * source is often a full rendered video, but bounded so a stalled transfer
   * can't buffer forever and wedge the worker.
   */
  timeoutMs?: number;
}

/**
 * Copy a file from an external URL to an S3 bucket
 *
 * Downloads the file from the source URL and uploads it to the destination bucket.
 * Useful for copying files from Remotion Lambda output to org-assets bucket.
 *
 * @param options - Copy options
 * @returns Upload result with etag
 *
 * @example
 * ```ts
 * const result = await copyFromUrl({
 *   sourceUrl: 'https://s3.amazonaws.com/remotion-bucket/output.mp4',
 *   bucket: 'org-assets',
 *   key: 'org-123/videos/rendered/video-456.mp4',
 *   contentType: 'video/mp4',
 * });
 * ```
 */
export async function copyFromUrl(
  options: CopyFromUrlOptions
): Promise<{ etag?: string }> {
  const { sourceUrl, bucket, key, contentType, timeoutMs = 60_000 } = options;

  // Download the file. Retries transient network/5xx failures and bounds each
  // attempt with a timeout so a stalled transfer can't buffer forever.
  const response = await fetchWithRetry(sourceUrl, { timeoutMs });
  if (!response.ok) {
    throw new Error(
      `Failed to download from source URL: ${response.status} ${response.statusText}`
    );
  }

  // Get the content as buffer
  const buffer = Buffer.from(await response.arrayBuffer());

  // Determine content type
  const finalContentType =
    contentType ||
    response.headers.get('content-type') ||
    'application/octet-stream';

  // Upload to destination
  return upload({
    bucket,
    key,
    body: buffer,
    contentType: finalContentType,
  });
}
