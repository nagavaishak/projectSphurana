import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
} from '@borradh-workspace/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@borradh-workspace/storage` and `@borradh-workspace/env/storage` are
// canonically aliased mocks (vite.config.ts) — drive the storage `vi.fn()`s with
// `vi.mocked()` and assert against the canonical env bucket name, rather than a
// file-local `vi.mock`, which would leak under `isolate: false`. The canonical
// `storageEnv.S3_ASSISTANT_UPLOADS_BUCKET` is `'mock-assistant-uploads-bucket'`.
const mockGetPresignedUploadUrl = vi.mocked(getPresignedUploadUrl);
const mockGetPresignedDownloadUrl = vi.mocked(getPresignedDownloadUrl);

const ASSISTANT_UPLOADS_BUCKET = 'mock-assistant-uploads-bucket';

import { ErrorCodes } from '../../../shared/index.js';
import { signUploadUrl } from './sign-upload-url.service.js';

const validInput = {
  organizationId: 'org-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  mimeType: 'image/jpeg' as const,
};

/**
 * The s3 key embeds a `nanoid()` id, which is random by design.
 *
 * This file used to `vi.mock('nanoid')` to pin it to a literal. That is unsafe
 * under `isolate: false` (the worker shares one module graph, so a hoisted
 * `vi.mock` silently MISSES once the real module is loaded — it duly broke
 * under `--singleThread`, returning a real random id), and `vi.spyOn` is not an
 * option either: nanoid's ESM namespace is non-configurable.
 *
 * So assert the key's SHAPE instead. That is what the test actually cares about
 * — prefix, id segment, extension — and it exercises the real generator rather
 * than a stub, so it cannot drift from production behaviour.
 */
const s3KeyPattern = (ext: string) =>
  new RegExp(`^org/org-1/conv/conv-1/upload/[A-Za-z0-9_-]+\\.${ext}$`);

describe('signUploadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPresignedUploadUrl.mockResolvedValue('https://s3.example/upload');
    mockGetPresignedDownloadUrl.mockResolvedValue(
      'https://s3.example/download'
    );
  });

  it('signs upload + download URLs for image/jpeg', async () => {
    const result = await signUploadUrl(validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.uploadUrl).toBe('https://s3.example/upload');
    expect(result.data.downloadUrl).toBe('https://s3.example/download');
    expect(result.data.bucket).toBe(ASSISTANT_UPLOADS_BUCKET);
    expect(result.data.s3Key).toMatch(s3KeyPattern('jpg'));
    expect(result.data.mimeType).toBe('image/jpeg');
    expect(result.data.contentLengthMax).toBe(10 * 1024 * 1024);
    expect(result.data.expiresAt).toBeInstanceOf(Date);
  });

  it.each([
    { mimeType: 'image/png' as const, ext: 'png' },
    { mimeType: 'image/webp' as const, ext: 'webp' },
  ])('signs URLs for $mimeType with .$ext key', async ({ mimeType, ext }) => {
    const result = await signUploadUrl({ ...validInput, mimeType });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.s3Key.endsWith(`.${ext}`)).toBe(true);
    expect(result.data.mimeType).toBe(mimeType);
  });

  it('passes ContentType to the upload signer (5 min TTL)', async () => {
    await signUploadUrl(validInput);

    expect(mockGetPresignedUploadUrl).toHaveBeenCalledWith({
      bucket: ASSISTANT_UPLOADS_BUCKET,
      key: expect.stringMatching(s3KeyPattern('jpg')),
      contentType: 'image/jpeg',
      expiresIn: 5 * 60,
    });
  });

  it('signs the download URL with a 1-hour TTL', async () => {
    await signUploadUrl(validInput);

    expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith({
      bucket: ASSISTANT_UPLOADS_BUCKET,
      key: expect.stringMatching(s3KeyPattern('jpg')),
      expiresIn: 60 * 60,
    });
  });

  it('namespaces the key by org + conversation (multi-org isolation)', async () => {
    const a = await signUploadUrl({ ...validInput, organizationId: 'org-A' });
    const b = await signUploadUrl({ ...validInput, organizationId: 'org-B' });
    expect(a.success && b.success).toBe(true);
    if (!a.success || !b.success) return;
    expect(a.data.s3Key.startsWith('org/org-A/')).toBe(true);
    expect(b.data.s3Key.startsWith('org/org-B/')).toBe(true);
  });

  it('returns VALIDATION_ERROR for unsupported MIME', async () => {
    const result = await signUploadUrl({
      ...validInput,
      // @ts-expect-error — runtime validation must reject this
      mimeType: 'image/gif',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockGetPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await signUploadUrl({
      ...validInput,
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR when the bucket is not configured', async () => {
    const env = await import('@borradh-workspace/env/storage');
    const original = env.storageEnv.S3_ASSISTANT_UPLOADS_BUCKET;
    (
      env.storageEnv as { S3_ASSISTANT_UPLOADS_BUCKET?: string }
    ).S3_ASSISTANT_UPLOADS_BUCKET = undefined;

    const result = await signUploadUrl(validInput);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);

    (
      env.storageEnv as { S3_ASSISTANT_UPLOADS_BUCKET?: string }
    ).S3_ASSISTANT_UPLOADS_BUCKET = original;
  });

  it('returns INTERNAL_ERROR when the signer throws', async () => {
    mockGetPresignedUploadUrl.mockRejectedValueOnce(new Error('S3 down'));
    const result = await signUploadUrl(validInput);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
