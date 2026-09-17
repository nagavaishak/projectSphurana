import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

/**
 * Test asset helper — resolves test files for upload tests.
 *
 * Resolution order:
 * 1. TEST_VIDEO_DIR env var (local dev — point to your own files)
 * 2. Download from public S3/CDN bucket (CI — no local files)
 * 3. Bundled fixture files (small images only)
 *
 * Public S3 assets live at: s3://{public-bucket}/e2e/
 * Upload once manually, available to every CI run forever.
 */

const ASSET_CACHE_DIR = path.resolve('node_modules/.cache/e2e-assets');
const TEST_VIDEO_DIR = process.env.TEST_VIDEO_DIR;

/**
 * Public base for the E2E media fixtures.
 *
 * The objects under it are NOT hand-maintained: `scripts/ensure-e2e-test-assets.sh`
 * pushes the committed bytes in `src/fixtures/assets/` to this prefix at the
 * start of every CI run that needs them (see the `provision-e2e-media` job in
 * e2e.yml and e2e-nightly.yml). Both times a fixture went missing, it was
 * because something read this prefix without anything restoring it.
 *
 * Exported because five call sites used to re-declare this literal, which is
 * how one of them can be pointed somewhere else and nobody notices.
 */
export const TEST_ASSETS_BASE_URL =
  process.env.TEST_ASSETS_URL ||
  'https://borradh-staging-public-assets.s3.eu-west-1.amazonaws.com/e2e';

interface TestAssets {
  video: string; // Path to a test MP4 file
  image: string; // Path to a test image file
}

/**
 * Ensure the asset cache directory exists.
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(ASSET_CACHE_DIR)) {
    fs.mkdirSync(ASSET_CACHE_DIR, { recursive: true });
  }
}

/**
 * Download a file from a URL to a local path.
 * Follows redirects (up to 3 hops).
 */
function downloadFile(
  url: string,
  dest: string,
  maxRedirects = 3
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (maxRedirects <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          downloadFile(res.headers.location, dest, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(
            new Error(`Failed to download ${url}: HTTP ${res.statusCode}`)
          );
          return;
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      })
      .on('error', reject);
  });
}

/**
 * Get a test video file path. Downloads from S3 if needed.
 *
 * @param filename - e.g. 'procedure1.mp4'
 * @returns Absolute path to the video file, or null if unavailable
 */
export async function getTestVideo(
  filename = 'test-video.mp4'
): Promise<string | null> {
  // 1. Local TEST_VIDEO_DIR (dev convenience)
  if (TEST_VIDEO_DIR) {
    const localPath = path.resolve(TEST_VIDEO_DIR, filename);
    if (fs.existsSync(localPath)) return localPath;
  }

  // 2. Already cached from a previous download
  const cachedPath = path.join(ASSET_CACHE_DIR, filename);
  if (fs.existsSync(cachedPath)) return cachedPath;

  // 3. Download from public S3
  try {
    ensureCacheDir();
    const url = `${TEST_ASSETS_BASE_URL}/${filename}`;
    console.log(`[TestAssets] Downloading ${url} → ${cachedPath}`);
    await downloadFile(url, cachedPath);
    console.log(
      `[TestAssets] Downloaded ${filename} (${fs.statSync(cachedPath).size} bytes)`
    );
    return cachedPath;
  } catch (err) {
    console.warn(
      `[TestAssets] Could not download ${filename}: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}

/**
 * Get a test image file path. Uses bundled fixture or downloads from S3.
 */
export async function getTestImage(
  filename = 'test-image.jpg'
): Promise<string | null> {
  // 1. Bundled fixture file
  const bundledPath = path.resolve('src/fixtures/assets', filename);
  if (fs.existsSync(bundledPath)) return bundledPath;

  // 2. Cached download
  const cachedPath = path.join(ASSET_CACHE_DIR, filename);
  if (fs.existsSync(cachedPath)) return cachedPath;

  // 3. Download from public S3
  try {
    ensureCacheDir();
    const url = `${TEST_ASSETS_BASE_URL}/${filename}`;
    await downloadFile(url, cachedPath);
    return cachedPath;
  } catch {
    return null;
  }
}

/**
 * Get all available test assets. Returns paths or null for unavailable assets.
 */
export async function getTestAssets(): Promise<TestAssets | null> {
  const [video, image] = await Promise.all([getTestVideo(), getTestImage()]);

  if (!video && !image) return null;

  return {
    video: video || '',
    image: image || '',
  };
}
