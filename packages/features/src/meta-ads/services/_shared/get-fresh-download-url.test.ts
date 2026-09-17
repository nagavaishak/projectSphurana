import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/storage` is canonically mocked in vite.config.ts, so a
// hoisted per-file `vi.mock('@borradh-workspace/storage', ...)` installs into
// the SHARED module registry and races with whichever file loads first. The
// canonical storage mock also does not export `getPresignedDownloadUrl` (it
// exports `generatePresignedDownloadUrl`), so this service genuinely needs a
// local stub.
//
// We register the storage stub with `vi.doMock` (non-hoisted, scoped) +
// `vi.resetModules()` + a dynamic `import()` of the service inside
// `beforeEach`, so nothing leaks into the shared registry.
//
// `@borradh-workspace/observability` is already mocked globally in
// `src/test-setup.ts` — no per-file mock needed.
// ---------------------------------------------------------------------------

const parseS3Url = vi.fn();
const getOrgAssetsBucket = vi.fn();
const getPresignedDownloadUrl = vi.fn();

let getFreshDownloadUrl: typeof import(
  './get-fresh-download-url.js'
).getFreshDownloadUrl;

describe('getFreshDownloadUrl', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock('@borradh-workspace/storage', () => ({
      parseS3Url,
      getOrgAssetsBucket,
      getPresignedDownloadUrl,
    }));

    ({ getFreshDownloadUrl } = await import('./get-fresh-download-url.js'));
  });

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/storage');
    vi.resetModules();
  });

  it('generates presigned URL for S3 URL', async () => {
    parseS3Url.mockReturnValue({
      bucket: 'my-bucket',
      key: 'org/video.mp4',
    });
    getPresignedDownloadUrl.mockResolvedValue(
      'https://my-bucket.s3.amazonaws.com/org/video.mp4?X-Amz-Signature=abc'
    );

    const result = await getFreshDownloadUrl(
      'https://my-bucket.s3.amazonaws.com/org/video.mp4'
    );

    expect(result).toBe(
      'https://my-bucket.s3.amazonaws.com/org/video.mp4?X-Amz-Signature=abc'
    );
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith({
      bucket: 'my-bucket',
      key: 'org/video.mp4',
      expiresIn: 3600,
    });
  });

  it('falls back to org-assets bucket for CDN URLs', async () => {
    parseS3Url.mockReturnValue(null);
    getOrgAssetsBucket.mockReturnValue('org-assets-bucket');
    getPresignedDownloadUrl.mockResolvedValue(
      'https://org-assets-bucket.s3.amazonaws.com/media/video.mp4?signed'
    );

    const result = await getFreshDownloadUrl(
      'https://cdn.example.com/media/video.mp4'
    );

    expect(result).toBe(
      'https://org-assets-bucket.s3.amazonaws.com/media/video.mp4?signed'
    );
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith({
      bucket: 'org-assets-bucket',
      key: 'media/video.mp4',
      expiresIn: 3600,
    });
  });

  it('strips leading slash from pathname for CDN URLs', async () => {
    parseS3Url.mockReturnValue(null);
    getOrgAssetsBucket.mockReturnValue('bucket');
    getPresignedDownloadUrl.mockResolvedValue('https://signed-url');

    await getFreshDownloadUrl('https://cdn.example.com/path/to/file.mp4');

    expect(getPresignedDownloadUrl).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'path/to/file.mp4',
      expiresIn: 3600,
    });
  });

  it('falls back to original URL on presign error', async () => {
    parseS3Url.mockReturnValue({
      bucket: 'my-bucket',
      key: 'video.mp4',
    });
    getPresignedDownloadUrl.mockRejectedValue(new Error('Access Denied'));

    const originalUrl = 'https://my-bucket.s3.amazonaws.com/video.mp4';
    const result = await getFreshDownloadUrl(originalUrl);

    expect(result).toBe(originalUrl);
  });

  it('falls back to original URL on invalid URL', async () => {
    const result = await getFreshDownloadUrl('not-a-valid-url');
    expect(result).toBe('not-a-valid-url');
  });
});
