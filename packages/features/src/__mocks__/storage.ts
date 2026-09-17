/**
 * Canonical mock for `@borradh-workspace/storage`.
 *
 * Aliased in vite.config.ts so every test file sees the *same* `vi.fn()`
 * instances — a prerequisite for `isolate: false`. Previously ~12 test files
 * each did a file-local `vi.mock('@borradh-workspace/storage', () => ({ … }))`
 * exporting a *different* subset of symbols. Under the shared worker graph the
 * last factory to register on the module registry won, so a file that needed
 * `isCdnEnabled`/`getOrgAssetsBucket`/etc. would see `undefined` (→ "(0 ,
 * isCdnEnabled) is not a function") whenever another file's narrower factory
 * (e.g. `delete-video`'s `{ deleteObject, parseS3Url }`) had been registered
 * for the shared module. See the MAINTENANCE RULE in vite.config.ts.
 *
 * This mock therefore exports the FULL union of symbols any service imports
 * from the real package, each as a `vi.fn()` with a neutral default. Tests that
 * need specific behaviour import the symbol and drive it with `vi.mocked(...)`,
 * re-establishing the impl in their own `beforeEach` (a sibling file may have
 * `vi.clearAllMocks()`-reset the shared instance). Do NOT re-add a file-local
 * `vi.mock('@borradh-workspace/storage')`.
 */

import { vi } from 'vitest';

// ── storage.ts (object operations) ─────────────────────────────────────────
export const upload = vi.fn().mockResolvedValue(undefined);
export const download = vi.fn().mockResolvedValue({ body: Buffer.from('') });
export const downloadAsBuffer = vi.fn().mockResolvedValue(Buffer.from(''));
export const downloadAsString = vi.fn().mockResolvedValue('');
export const deleteObject = vi.fn().mockResolvedValue(undefined);
export const exists = vi.fn().mockResolvedValue(false);
export const getMetadata = vi.fn().mockResolvedValue({});
export const list = vi.fn().mockResolvedValue({ objects: [] });
export const copy = vi.fn().mockResolvedValue({});
export const copyFromUrl = vi.fn().mockResolvedValue({});
export const getPresignedDownloadUrl = vi
  .fn()
  .mockResolvedValue('https://mock-download-url.example.com');
export const getPresignedUploadUrl = vi.fn().mockResolvedValue({
  url: 'https://mock-upload-url.example.com',
  key: 'mock-key',
});
export const attachmentDisposition = vi
  .fn()
  .mockImplementation(
    (fileName: string) => `attachment; filename="${fileName}"`
  );

// ── s3-client.ts (bucket/region helpers) ───────────────────────────────────
export const getS3Client = vi.fn().mockReturnValue({});
export const getDefaultBucket = vi.fn().mockReturnValue('mock-default-bucket');
export const getPublicAssetsBucket = vi
  .fn()
  .mockReturnValue('mock-public-bucket');
export const getOrgAssetsBucket = vi.fn().mockReturnValue('mock-org-bucket');
export const getAnalyticsBucket = vi
  .fn()
  .mockReturnValue('mock-analytics-bucket');
export const getImageTemplatesBucket = vi
  .fn()
  .mockReturnValue('mock-image-templates-bucket');
export const getImageTemplatesPublicBaseUrl = vi
  .fn()
  .mockReturnValue('https://mock-image-templates.example.com');
export const getS3Region = vi.fn().mockReturnValue('eu-west-1');

// ── cloudfront-client.ts (CDN helpers) ─────────────────────────────────────
export const isCdnEnabled = vi.fn().mockReturnValue(false);
export const getCdnUrl = vi.fn().mockReturnValue(undefined);
export const generateSignedCookies = vi.fn().mockReturnValue({});
export const getPrivateCdnUrl = vi
  .fn()
  .mockReturnValue('https://mock-cdn.example.com/private');
export const getSignedCdnUrl = vi
  .fn()
  .mockReturnValue('https://mock-cdn.example.com/signed');
export const getPublicCdnUrl = vi
  .fn()
  .mockReturnValue('https://mock-cdn.example.com/public');
export const extractOrgIdFromKey = vi.fn().mockReturnValue(null);

// ── url-utils.ts ───────────────────────────────────────────────────────────
export const parseS3Url = vi.fn().mockReturnValue(null);
export const extractKeyFromCdnUrl = vi.fn().mockReturnValue(null);
