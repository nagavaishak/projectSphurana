import { createHmac } from 'node:crypto';
import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  isMessengerEligible,
  messengerEligibleQuestionTypes,
  toMetaQuestionType,
} from '@borradh-workspace/labels';
import { logError } from '@borradh-workspace/observability';
import sharp from 'sharp';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import { logMetaApiError } from '../shared/log-meta-api-error.js';
import {
  MetaApiError,
  type MetaErrorResponse,
  extractMetaErrorContext,
  parseMetaErrorResponse,
} from '../shared/meta-api-error.js';
import { metaPageSubscribedFields } from '../webhooks/index.js';
import type {
  MetaAdConfig,
  MetaAdCreativeConfig,
  MetaAdData,
  MetaAdImageCreativeConfig,
  MetaAdImportFields,
  MetaAdSetConfig,
  MetaAdSetData,
  MetaAdWithCreative,
  MetaAdsCredentials,
  MetaCampaignConfig,
  MetaCampaignData,
  MetaImageUploadResult,
  MetaInsightsData,
  MetaLeadData,
  MetaLeadFormConfig,
  MetaLeadFormData,
  MetaLeadFormQuestion,
  MetaVideoStatus,
  MetaVideoUploadResult,
} from './meta-ads.types.js';

/**
 * Messenger auto-start eligibility now lives in `@borradh-workspace/labels`,
 * beside the field-type labels it constrains, so the assistant adapter and the
 * form builder can apply the same rule. Re-exported here because this module
 * is where callers first met it.
 */
export {
  messengerEligibleQuestionTypes as MESSENGER_ELIGIBLE_QUESTION_TYPES,
  isMessengerEligible,
};

const RATE_LIMIT_MAX_RETRIES = 3;

/**
 * Graph's `paging.next` is an absolute URL that already carries the credentials
 * used for the first call. `apiRequest` appends its own `access_token` (and
 * `appsecret_proof`), and Meta rejects a request that carries two of either —
 * so strip Meta's copy before following the cursor.
 */
function stripAuthParams(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    url.searchParams.delete('access_token');
    url.searchParams.delete('appsecret_proof');
    return url.toString();
  } catch {
    return undefined;
  }
}
const RATE_LIMIT_BASE_DELAY_MS = 1000;

/**
 * Thrown when Meta rejects a request with "Invalid appsecret_proof".
 *
 * This means the stored access token was minted by a Meta App whose
 * `app_secret` does not match the one we are using to compute appsecret_proof.
 * Root cause is an environment/app mismatch (prod META_APP_SECRET points at a
 * different Meta App than the one that minted the token), not a transient
 * failure. Callers should skip the affected organization for the current cycle
 * and surface the issue out-of-band rather than logging to Sentry on every
 * request.
 */
export class MetaAppSecretMismatchError extends Error {
  readonly metaError: MetaApiError;

  constructor(metaError: MetaApiError) {
    super(metaError.message);
    this.name = 'MetaAppSecretMismatchError';
    this.metaError = metaError;
  }
}

function isAppSecretProofError(error: MetaApiError): boolean {
  return /appsecret_proof/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter: baseDelay * 2^attempt + random 0-500ms */
function getBackoffDelay(attempt: number): number {
  return RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
}

/**
 * Service for managing Meta Marketing API operations
 * Handles campaigns, ad sets, ad creatives, ads, and video uploads
 */
/**
 * The shape of an ad creative, as far as picking a preview image goes.
 * Only the fields we read — Meta returns many more.
 */
export interface MetaCreativePreviewFields {
  thumbnail_url?: string;
  image_url?: string;
  object_story_spec?: {
    video_data?: { image_url?: string };
    link_data?: { picture?: string };
  };
}

/**
 * Read an ad creative's COPY, wherever Meta happens to keep it.
 *
 * Graph exposes `creative.title` / `creative.body` as top-level fields, but
 * they are only populated for creatives that were CREATED with them. Every
 * creative Borradh builds goes through `object_story_spec` — `link_data` for
 * image ads, `video_data` for video — and for those the top-level fields come
 * back EMPTY while the real copy sits one level down (`link_data.name` is the
 * headline, `link_data.message` the primary text).
 *
 * Reading only the top level therefore reported "this ad has no copy" for
 * every ad we have ever published. `importMetaAds` believed it and wrote the
 * nulls over the copy the owner had typed — verified on a preview: one
 * `POST /meta-ads/import` blanked headline, primaryText, description and
 * destinationUrl on a live ad, and the next copy edit would then have rebuilt
 * the creative from those blanks and pushed EMPTY copy to the running ad.
 *
 * Order is deliberate: top-level first (an ad genuinely created that way), then
 * the story spec.
 */
export function readCreativeCopy(creative: {
  title?: string;
  body?: string;
  link_url?: string;
  object_story_spec?: {
    video_data?: {
      title?: string;
      message?: string;
      link_description?: string;
    };
    link_data?: {
      name?: string;
      message?: string;
      description?: string;
      link?: string;
    };
  };
}): {
  title?: string;
  body?: string;
  linkUrl?: string;
  linkDescription?: string;
} {
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;
  return {
    title: creative.title ?? link?.name ?? video?.title,
    body: creative.body ?? link?.message ?? video?.message,
    linkUrl: creative.link_url ?? link?.link,
    linkDescription: link?.description ?? video?.link_description,
  };
}

/**
 * Pick the best preview image for an ad creative.
 *
 * `thumbnail_url` is LAST on purpose. Meta always answers it with a 64x64
 * CENTER-CROPPED square — `stp=c0.5000x0.5000f_..._p64x64_...` — and ignores
 * the `.width()/.height()` field modifiers entirely (verified against
 * production creatives: 1080, 1350 and 1920 requests all came back 64x64). A
 * preview built on it is both tiny and cropped through the middle of the
 * creative, which is exactly what imported ads used to look like.
 *
 * The full-size sources, in the order they actually carry the creative:
 *  - `image_url` — image creatives (`object_type: SHARE`); measured 1260x2240.
 *  - `object_story_spec.video_data.image_url` — video creatives; measured
 *    1080x1920, the video's own cover frame.
 *  - `object_story_spec.link_data.picture` — link creatives.
 */
export function pickCreativePreviewUrl(
  creative: MetaCreativePreviewFields | undefined
): string | undefined {
  if (!creative) return undefined;
  return (
    creative.image_url ||
    creative.object_story_spec?.video_data?.image_url ||
    creative.object_story_spec?.link_data?.picture ||
    creative.thumbnail_url
  );
}

export class MetaAdsService {
  private accessToken: string;
  private adAccountId: string;
  private pageId: string;
  private appSecret: string | undefined;
  constructor(credentials: MetaAdsCredentials) {
    this.accessToken = credentials.accessToken;
    this.adAccountId = credentials.adAccountId;
    this.pageId = credentials.pageId;
    this.appSecret = credentials.appSecret;

    // Ensure ad account ID has the correct prefix
    if (!this.adAccountId.startsWith('act_')) {
      this.adAccountId = `act_${this.adAccountId}`;
    }
  }

  // ==================== HELPER METHODS ====================

  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${GRAPH_API_BASE}${endpoint}`;

    const separator = url.includes('?') ? '&' : '?';
    let urlWithToken = `${url}${separator}access_token=${this.accessToken}`;

    if (this.appSecret) {
      const proof = createHmac('sha256', this.appSecret)
        .update(this.accessToken)
        .digest('hex');
      urlWithToken += `&appsecret_proof=${proof}`;
    }

    // DEBUG: Log outgoing request (redact token)
    const redactedUrl = url;
    if (options.method === 'POST') {
      console.log(`[META-DEBUG] ${options.method} ${redactedUrl}`, {
        adAccountId: this.adAccountId,
        pageId: this.pageId,
        body: options.body ? JSON.parse(options.body as string) : undefined,
        tokenPrefix: `${this.accessToken.substring(0, 10)}...`,
      });
    }

    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      const response = await fetchWithTimeout(urlWithToken, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        timeoutMs: 20000,
      });

      if (!response.ok) {
        const error = await parseMetaErrorResponse(
          response,
          `API request to ${endpoint.split('?')[0]} failed`
        );

        if (error.isRateLimited && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.warn(
            `[META] Rate limited on ${endpoint.split('?')[0]}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
          );
          await sleep(delay);
          continue;
        }

        // TODO: root cause is META_APP_SECRET vs stored token app mismatch — see
        // fix/sentry-api-error-handling-hardening. Defensive suppression only.
        if (isAppSecretProofError(error)) {
          throw new MetaAppSecretMismatchError(error);
        }

        if (!error.errorInfo || error.errorInfo.category === 'unknown') {
          logError('metaAds.apiRequest', error, {
            feature: 'meta-ads',
            extra: {
              endpoint,
              status: response.status,
              attempt,
              requestBody: options.body
                ? JSON.parse(options.body as string)
                : undefined,
              ...extractMetaErrorContext(error),
            },
          });
        }
        throw error;
      }

      const data = (await response.json()) as T & {
        error?: { message?: string };
      };

      // Meta sometimes returns HTTP 200 with an error object in the body
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        const error = new MetaApiError(
          data as unknown as MetaErrorResponse,
          `API request to ${endpoint.split('?')[0]} failed`
        );

        if (error.isRateLimited && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.warn(
            `[META] Rate limited on ${endpoint.split('?')[0]}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
          );
          await sleep(delay);
          continue;
        }

        // TODO: root cause is META_APP_SECRET vs stored token app mismatch — see
        // fix/sentry-api-error-handling-hardening. Defensive suppression only.
        if (isAppSecretProofError(error)) {
          throw new MetaAppSecretMismatchError(error);
        }

        if (!error.errorInfo || error.errorInfo.category === 'unknown') {
          logError('metaAds.apiRequest', error, {
            feature: 'meta-ads',
            extra: {
              endpoint,
              status: response.status,
              bodyError: true,
              attempt,
              requestBody: options.body
                ? JSON.parse(options.body as string)
                : undefined,
              ...extractMetaErrorContext(error),
            },
          });
        }
        throw error;
      }

      return data;
    }

    // This should never be reached — the loop always returns or throws
    throw new Error(
      `Meta API request to ${endpoint.split('?')[0]} failed after ${RATE_LIMIT_MAX_RETRIES} retries`
    );
  }

  /**
   * Validate that a Meta API create response contains a valid ID.
   * Meta should always return `{ id: "..." }` for successful creates,
   * but if the response is malformed we must fail loudly rather than
   * storing undefined/null IDs and marking resources as active.
   */
  private requireId(data: { id?: string }, entity: string): string {
    if (!data.id || typeof data.id !== 'string') {
      const error = new Error(
        `Meta API Error: ${entity} creation returned an invalid response (missing id)`
      );
      logError(`metaAds.create${entity.replace(/\s+/g, '')}`, error, {
        feature: 'meta-ads',
        extra: { entity, response: data },
      });
      throw error;
    }
    return data.id;
  }

  // ==================== VIDEO UPLOAD ====================

  /** Threshold (bytes) above which we use chunked upload. 20 MB. */
  private static readonly CHUNKED_UPLOAD_THRESHOLD = 20 * 1024 * 1024;
  /** Chunk size for chunked uploads. 4 MB. */
  private static readonly CHUNK_SIZE = 4 * 1024 * 1024;

  /**
   * Build the ad-videos endpoint URL with auth params.
   */
  private adVideosUrl(): string {
    let url = `${GRAPH_API_BASE}/${this.adAccountId}/advideos?access_token=${this.accessToken}`;
    if (this.appSecret) {
      const proof = createHmac('sha256', this.appSecret)
        .update(this.accessToken)
        .digest('hex');
      url += `&appsecret_proof=${proof}`;
    }
    return url;
  }

  /**
   * Upload a video to Meta from a URL.
   *
   * For small files (<20 MB) uses a single multipart request.
   * For larger files uses Meta's chunked upload protocol (start/transfer/finish)
   * to avoid HTTP 413 errors.
   *
   * @param videoUrl Presigned S3 URL or accessible URL of the video
   * @param title Title for the video
   * @returns Upload result with video ID
   */
  async uploadVideo(
    videoUrl: string,
    title: string
  ): Promise<MetaVideoUploadResult> {
    // Download the video ourselves and upload directly to Meta.
    // This avoids Meta needing to reach our presigned S3 URL, which can fail
    // due to URL length, encoding issues, or network restrictions.
    const parsedVideoUrl = new URL(videoUrl);
    console.log(
      `Downloading video for Meta upload: host=${parsedVideoUrl.hostname}, path=${parsedVideoUrl.pathname}, urlLength=${videoUrl.length}`
    );
    const downloadResponse = await fetchWithRetry(videoUrl, {
      timeoutMs: 30000,
    });
    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download video from S3: HTTP ${downloadResponse.status} ${downloadResponse.statusText} (host=${parsedVideoUrl.hostname}, path=${parsedVideoUrl.pathname})`
      );
    }

    const videoBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    const contentType =
      downloadResponse.headers.get('content-type') || 'video/mp4';
    console.log(
      `Video downloaded: ${videoBuffer.length} bytes, contentType=${contentType}`
    );

    if (videoBuffer.length >= MetaAdsService.CHUNKED_UPLOAD_THRESHOLD) {
      return this.uploadVideoChunked(videoBuffer, title);
    }
    return this.uploadVideoSingle(videoBuffer, title, contentType);
  }

  /**
   * Single-request upload for small videos (<20 MB).
   */
  private async uploadVideoSingle(
    videoBuffer: Buffer,
    title: string,
    contentType: string
  ): Promise<MetaVideoUploadResult> {
    const boundary = `----MetaUpload${Date.now()}`;
    const parts: Buffer[] = [];

    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`
      )
    );
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${this.accessToken}\r\n`
      )
    );
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="video.mp4"\r\nContent-Type: ${contentType}\r\n\r\n`
      )
    );
    parts.push(videoBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/${this.adAccountId}/advideos`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        timeoutMs: 60000,
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const error = JSON.parse(responseText) as {
          error?: { message?: string };
        };
        errorMessage = error.error?.message || errorMessage;
      } catch {
        errorMessage = responseText || errorMessage;
      }
      throw new Error(`Failed to upload video: ${errorMessage}`);
    }

    if (!responseText) {
      throw new Error('Failed to upload video: Empty response from Meta API');
    }

    const data = JSON.parse(responseText) as {
      id: string;
      thumbnails?: Array<{ uri: string }>;
    };
    return {
      videoId: data.id,
      thumbnails: data.thumbnails,
    };
  }

  /**
   * Chunked upload for large videos (>=20 MB).
   * Uses Meta's 3-phase protocol: start → transfer → finish.
   * https://developers.facebook.com/docs/video-api/guides/publishing
   */
  private async uploadVideoChunked(
    videoBuffer: Buffer,
    title: string
  ): Promise<MetaVideoUploadResult> {
    const fileSize = videoBuffer.length;
    console.log(
      `Using chunked upload for ${fileSize} bytes (${Math.ceil(fileSize / MetaAdsService.CHUNK_SIZE)} chunks)`
    );

    // Phase 1: Start — get upload session ID and first chunk offsets
    const startUrl = this.adVideosUrl();
    const startResponse = await fetchWithTimeout(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'start',
        file_size: String(fileSize),
      }),
      timeoutMs: 60000,
    });

    if (!startResponse.ok) {
      const err = await this.parseVideoUploadError(startResponse);
      throw new Error(`Failed to start chunked video upload: ${err}`);
    }

    const startData = (await startResponse.json()) as {
      upload_session_id: string;
      video_id: string;
      start_offset: string;
      end_offset: string;
    };

    const { upload_session_id, video_id } = startData;
    let startOffset = Number(startData.start_offset);
    let endOffset = Number(startData.end_offset);

    console.log(
      `Chunked upload started: sessionId=${upload_session_id}, videoId=${video_id}`
    );

    // Phase 2: Transfer — send chunks until start_offset == end_offset
    let chunkIndex = 0;
    while (startOffset < endOffset) {
      const chunk = videoBuffer.subarray(startOffset, endOffset);
      chunkIndex++;
      console.log(
        `Uploading chunk ${chunkIndex}: offset ${startOffset}-${endOffset} (${chunk.length} bytes)`
      );

      const boundary = `----MetaChunk${Date.now()}`;
      const parts: Buffer[] = [];

      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="upload_phase"\r\n\r\ntransfer\r\n`
        )
      );
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="upload_session_id"\r\n\r\n${upload_session_id}\r\n`
        )
      );
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="start_offset"\r\n\r\n${startOffset}\r\n`
        )
      );
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="video_file_chunk"; filename="chunk.mp4"\r\nContent-Type: application/octet-stream\r\n\r\n`
        )
      );
      parts.push(chunk);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const chunkBody = Buffer.concat(parts);
      const transferResponse = await fetchWithTimeout(this.adVideosUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: chunkBody,
        timeoutMs: 60000,
      });

      if (!transferResponse.ok) {
        const err = await this.parseVideoUploadError(transferResponse);
        throw new Error(
          `Failed to upload video chunk ${chunkIndex} (offset ${startOffset}): ${err}`
        );
      }

      const transferData = (await transferResponse.json()) as {
        start_offset: string;
        end_offset: string;
      };

      startOffset = Number(transferData.start_offset);
      endOffset = Number(transferData.end_offset);
    }

    console.log(`All ${chunkIndex} chunks uploaded, finishing upload session`);

    // Phase 3: Finish — finalize the upload
    const finishResponse = await fetchWithTimeout(this.adVideosUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        upload_session_id,
        title,
      }),
      timeoutMs: 60000,
    });

    if (!finishResponse.ok) {
      const err = await this.parseVideoUploadError(finishResponse);
      throw new Error(`Failed to finish chunked video upload: ${err}`);
    }

    const finishData = (await finishResponse.json()) as {
      success?: boolean;
    };

    if (finishData.success === false) {
      throw new Error(
        'Failed to finish chunked video upload: Meta returned success=false'
      );
    }

    console.log(`Chunked upload complete: videoId=${video_id}`);

    return { videoId: video_id };
  }

  /**
   * Parse error message from a failed video upload response.
   */
  private async parseVideoUploadError(response: Response): Promise<string> {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const responseText = await response.text();
      const error = JSON.parse(responseText) as {
        error?: { message?: string };
      };
      errorMessage = error.error?.message || responseText || errorMessage;
    } catch {
      // keep the HTTP status message
    }
    return errorMessage;
  }

  /**
   * Check the processing status of an uploaded video
   * @param videoId Video ID to check
   * @returns Video status
   */
  async getVideoStatus(videoId: string): Promise<MetaVideoStatus> {
    const data = await this.apiRequest<{
      status: { video_status: string };
      picture?: string;
      thumbnails?: { data?: Array<{ uri: string }> };
    }>(`/${videoId}?fields=status,picture,thumbnails`);

    const status = data.status?.video_status || 'processing';
    const thumbnailUrl =
      data.thumbnails?.data?.[0]?.uri || data.picture || undefined;

    return {
      status: status as 'processing' | 'ready' | 'error',
      isReady: status === 'ready',
      errorMessage: status === 'error' ? 'Video processing failed' : undefined,
      thumbnailUrl,
    };
  }

  /**
   * Wait for a video to finish processing
   * @param videoId Video ID to wait for
   * @param maxAttempts Maximum number of polling attempts
   * @param intervalMs Milliseconds between attempts
   * @returns Final video status
   */
  async waitForVideoReady(
    videoId: string,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<MetaVideoStatus> {
    // Exponential backoff with a cap — cuts API calls ~4x compared to a
    // fixed interval while preserving the same total wait budget. The
    // maxAttempts/intervalMs signature is kept for caller compatibility;
    // their product is treated as the total wait budget.
    const totalBudgetMs = maxAttempts * intervalMs;
    const initialDelayMs = Math.max(intervalMs, 3000);
    const maxDelayMs = 15000;

    const deadline = Date.now() + totalBudgetMs;
    let delayMs = initialDelayMs;

    while (Date.now() < deadline) {
      const status = await this.getVideoStatus(videoId);

      if (status.isReady || status.status === 'error') {
        return status;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(delayMs, remaining));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }

    return {
      status: 'error',
      isReady: false,
      errorMessage: 'Video processing timed out',
    };
  }

  // ==================== IMAGE UPLOAD ====================

  /**
   * Upload an image to Meta's `/adimages` endpoint and return its image hash.
   *
   * We download the bytes ourselves and POST them as multipart form-data
   * (same pattern as uploadVideo — avoids Meta needing to reach presigned URLs).
   *
   * Meta's `/adimages` only accepts JPEG and PNG. Our graphics can be rendered
   * as WebP (see `graphic.outputs[].format`), and a wrong/missing Content-Type
   * header can mask other formats — Meta rejects all of these with a generic
   * "(#100) Invalid parameter". To make the upload robust we inspect the actual
   * bytes and transcode anything that isn't JPEG/PNG to PNG before sending.
   *
   * @param imageUrl Presigned S3 URL or accessible URL of the image
   * @returns Upload result with image hash
   */
  async uploadImage(imageUrl: string): Promise<MetaImageUploadResult> {
    const parsedUrl = new URL(imageUrl);
    console.log(
      `Downloading image for Meta upload: host=${parsedUrl.hostname}, path=${parsedUrl.pathname}`
    );
    const downloadResponse = await fetchWithRetry(imageUrl, {
      timeoutMs: 30000,
    });
    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download image: HTTP ${downloadResponse.status} ${downloadResponse.statusText}`
      );
    }

    let imageBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    let contentType =
      downloadResponse.headers.get('content-type') || 'image/jpeg';
    console.log(
      `Image downloaded: ${imageBuffer.length} bytes, contentType=${contentType}`
    );

    // Normalise to a Meta-supported format based on the real bytes, not the
    // (possibly wrong) Content-Type header. Anything that isn't JPEG/PNG is
    // transcoded to PNG so Meta doesn't reject it with "Invalid parameter".
    try {
      const format = (await sharp(imageBuffer).metadata()).format;
      if (format === 'jpeg') {
        contentType = 'image/jpeg';
      } else if (format === 'png') {
        contentType = 'image/png';
      } else if (format) {
        console.log(
          `Transcoding image/${format} → image/png for Meta upload (Meta /adimages only accepts JPEG/PNG)`
        );
        imageBuffer = await sharp(imageBuffer).png().toBuffer();
        contentType = 'image/png';
      }
      // format === undefined → sharp couldn't decode it; upload the original
      // bytes and let Meta report the specific reason.
    } catch (error) {
      console.warn(
        `Image normalization failed; uploading original bytes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Determine file extension from content type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
    };
    const ext = extMap[contentType] || 'jpg';

    // Build multipart form data
    const boundary = `----MetaImageUpload${Date.now()}`;
    const parts: Buffer[] = [];

    // Add access_token field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${this.accessToken}\r\n`
      )
    );

    // Add image file as "filename" parameter
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="image.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`
      )
    );
    parts.push(imageBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/${this.adAccountId}/adimages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        timeoutMs: 60000,
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      // Surface Meta's full error (code, subcode, error_user_msg, fbtrace_id)
      // via MetaApiError so the failure is classifiable and Sentry captures the
      // real reason instead of a bare "Invalid parameter".
      let errorBody: MetaErrorResponse = {};
      try {
        errorBody = JSON.parse(responseText) as MetaErrorResponse;
      } catch {
        // Non-JSON body — keep the raw text in the fallback message below.
      }
      throw new MetaApiError(
        errorBody,
        `Failed to upload image (HTTP ${response.status}${
          responseText ? `, body: ${responseText.slice(0, 200)}` : ''
        })`
      );
    }

    if (!responseText) {
      throw new Error('Failed to upload image: Empty response from Meta API');
    }

    // Response format: { images: { <filename>: { hash: "abc123", ... } } }
    const data = JSON.parse(responseText) as {
      images: Record<string, { hash: string }>;
    };

    const imageKey = Object.keys(data.images)[0];
    if (!imageKey || !data.images[imageKey]?.hash) {
      throw new Error('Failed to upload image: No hash returned from Meta API');
    }

    return { imageHash: data.images[imageKey].hash };
  }

  // ==================== AD CREATIVE MANAGEMENT (IMAGE) ====================

  /**
   * Create an ad creative for image ads (uses link_data instead of video_data)
   * @param config Image creative configuration
   * @returns Creative ID
   */
  async createAdCreativeFromImage(
    config: MetaAdImageCreativeConfig
  ): Promise<string> {
    const linkData: Record<string, unknown> = {
      image_hash: config.objectStorySpec.linkData.imageHash,
    };

    if (config.objectStorySpec.linkData.message) {
      linkData.message = config.objectStorySpec.linkData.message;
    }
    if (config.objectStorySpec.linkData.name) {
      linkData.name = config.objectStorySpec.linkData.name;
    }
    if (config.objectStorySpec.linkData.description) {
      linkData.description = config.objectStorySpec.linkData.description;
    }
    if (config.objectStorySpec.linkData.link) {
      linkData.link = config.objectStorySpec.linkData.link;
    }
    if (config.objectStorySpec.linkData.callToAction) {
      linkData.call_to_action = {
        type: config.objectStorySpec.linkData.callToAction.type,
        ...(config.objectStorySpec.linkData.callToAction.value && {
          value: {
            ...(config.objectStorySpec.linkData.callToAction.value.link && {
              link: config.objectStorySpec.linkData.callToAction.value.link,
            }),
            ...(config.objectStorySpec.linkData.callToAction.value
              .leadGenFormId && {
              lead_gen_form_id:
                config.objectStorySpec.linkData.callToAction.value
                  .leadGenFormId,
            }),
            ...(config.objectStorySpec.linkData.callToAction.value
              .appDestination && {
              app_destination:
                config.objectStorySpec.linkData.callToAction.value
                  .appDestination,
            }),
          },
        }),
      };
    }
    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.name,
          object_story_spec: {
            page_id: config.objectStorySpec.pageId,
            ...(config.objectStorySpec.instagramActorId && {
              instagram_user_id: config.objectStorySpec.instagramActorId,
            }),
            link_data: linkData,
          },
          ...(config.degreesOfFreedomSpec && {
            degrees_of_freedom_spec: config.degreesOfFreedomSpec,
          }),
          ...(config.assetFeedSpec && {
            asset_feed_spec: config.assetFeedSpec,
          }),
        }),
      }
    );

    return this.requireId(data, 'ad creative (image)');
  }

  // ==================== CAMPAIGN MANAGEMENT ====================

  /**
   * Create a new campaign
   * @param config Campaign configuration
   * @returns Campaign ID
   */
  async createCampaign(config: MetaCampaignConfig): Promise<string> {
    // Determine if we're using campaign budget optimization (CBO)
    const useCBO = !!(config.dailyBudget || config.lifetimeBudget);

    const payload = {
      name: config.name,
      objective: config.objective,
      status: config.status,
      special_ad_categories: config.specialAdCategories || [],
      buying_type: 'AUCTION', // Required for ODAX objectives
      // Required when not using CBO - controls ad set budget sharing
      ...(!useCBO && { is_adset_budget_sharing_enabled: false }),
      // With CBO, set bid_strategy on the campaign so ad sets inherit it
      ...(useCBO && { bid_strategy: 'LOWEST_COST_WITHOUT_CAP' }),
      ...(config.dailyBudget && { daily_budget: config.dailyBudget }),
      ...(config.lifetimeBudget && {
        lifetime_budget: config.lifetimeBudget,
      }),
    };

    console.log(
      'Creating Meta campaign with payload:',
      JSON.stringify(payload, null, 2)
    );

    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/campaigns`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return this.requireId(data, 'campaign');
  }

  /**
   * Get campaign details
   * @param campaignId Campaign ID
   * @returns Campaign data
   */
  async getCampaign(campaignId: string): Promise<MetaCampaignData> {
    const data = await this.apiRequest<{
      id: string;
      name: string;
      status: string;
      effective_status: string;
      objective: string;
      created_time?: string;
      updated_time?: string;
    }>(
      `/${campaignId}?fields=id,name,status,effective_status,objective,created_time,updated_time`
    );

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      effectiveStatus: data.effective_status,
      objective: data.objective,
      createdTime: data.created_time,
      updatedTime: data.updated_time,
    };
  }

  /**
   * Update a campaign
   * @param campaignId Campaign ID
   * @param updates Updates to apply
   */
  async updateCampaign(
    campaignId: string,
    updates: Partial<MetaCampaignConfig>
  ): Promise<void> {
    await this.apiRequest(`/${campaignId}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(updates.name && { name: updates.name }),
        ...(updates.status && { status: updates.status }),
        ...(updates.dailyBudget !== undefined && {
          daily_budget: updates.dailyBudget,
        }),
      }),
    });
  }

  /**
   * Delete a campaign
   * @param campaignId Campaign ID
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    await this.apiRequest(`/${campaignId}`, { method: 'DELETE' });
  }

  // ==================== AD SET MANAGEMENT ====================

  /**
   * Create an ad set (auto-created per campaign, hidden from user)
   * @param config Ad set configuration
   * @returns Ad set ID
   */
  async createAdSet(config: MetaAdSetConfig): Promise<string> {
    const payload = {
      name: config.name,
      campaign_id: config.campaignId,
      status: config.status,
      billing_event: config.billingEvent,
      optimization_goal: config.optimizationGoal,
      targeting: config.targeting,
      // Only set bid_strategy when explicitly provided (ABO mode).
      // With CBO (campaign-level budget), bid_strategy is inherited from the campaign.
      ...(config.bidStrategy && { bid_strategy: config.bidStrategy }),
      ...(config.startTime && { start_time: config.startTime }),
      ...(config.endTime && { end_time: config.endTime }),
      ...(config.dailyBudget && { daily_budget: config.dailyBudget }),
      ...(config.bidAmount && { bid_amount: config.bidAmount }),
      ...(config.promotedObject && {
        promoted_object: {
          ...(config.promotedObject.pageId && {
            page_id: config.promotedObject.pageId,
          }),
          ...(config.promotedObject.pixelId && {
            pixel_id: config.promotedObject.pixelId,
          }),
          ...(config.promotedObject.customEventType && {
            custom_event_type: config.promotedObject.customEventType,
          }),
          ...(config.promotedObject.whatsappPhoneNumber && {
            whatsapp_phone_number: config.promotedObject.whatsappPhoneNumber,
          }),
        },
      }),
      ...(config.destinationType && {
        destination_type: config.destinationType,
      }),
      ...(config.dsaBeneficiary && {
        dsa_beneficiary: config.dsaBeneficiary,
      }),
      ...(config.dsaPayor && { dsa_payor: config.dsaPayor }),
    };

    console.log(
      'Creating Meta ad set with payload:',
      JSON.stringify(payload, null, 2)
    );

    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/adsets`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return this.requireId(data, 'ad set');
  }

  /**
   * Update an ad set
   * @param adSetId Ad set ID
   * @param updates Updates to apply
   */
  async updateAdSet(
    adSetId: string,
    updates: Partial<MetaAdSetConfig>
  ): Promise<void> {
    await this.apiRequest(`/${adSetId}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(updates.status && { status: updates.status }),
        ...(updates.targeting && { targeting: updates.targeting }),
        ...(updates.dailyBudget !== undefined && {
          daily_budget: updates.dailyBudget,
        }),
        ...(updates.promotedObject && {
          promoted_object: {
            ...(updates.promotedObject.pageId && {
              page_id: updates.promotedObject.pageId,
            }),
            ...(updates.promotedObject.pixelId && {
              pixel_id: updates.promotedObject.pixelId,
            }),
            ...(updates.promotedObject.customEventType && {
              custom_event_type: updates.promotedObject.customEventType,
            }),
            ...(updates.promotedObject.whatsappPhoneNumber && {
              whatsapp_phone_number: updates.promotedObject.whatsappPhoneNumber,
            }),
          },
        }),
      }),
    });
  }

  /**
   * Delete an ad set
   * @param adSetId Ad set ID
   */
  async deleteAdSet(adSetId: string): Promise<void> {
    await this.apiRequest(`/${adSetId}`, { method: 'DELETE' });
  }

  // ==================== AD CREATIVE MANAGEMENT ====================

  /**
   * Create an ad creative for video ads
   * @param config Creative configuration
   * @returns Creative ID
   */
  async createAdCreative(config: MetaAdCreativeConfig): Promise<string> {
    const videoData: Record<string, unknown> = {
      video_id: config.objectStorySpec.videoData.videoId,
    };

    if (config.objectStorySpec.videoData.imageUrl) {
      videoData.image_url = config.objectStorySpec.videoData.imageUrl;
    }
    if (config.objectStorySpec.videoData.title) {
      videoData.title = config.objectStorySpec.videoData.title;
    }
    if (config.objectStorySpec.videoData.message) {
      videoData.message = config.objectStorySpec.videoData.message;
    }
    // link_description is deprecated in Meta Graph API v21.0+
    // Omitting to avoid field access errors
    if (config.objectStorySpec.videoData.callToAction) {
      const ctaVal = config.objectStorySpec.videoData.callToAction.value;
      videoData.call_to_action = {
        type: config.objectStorySpec.videoData.callToAction.type,
        value: {
          ...(ctaVal?.link && { link: ctaVal.link }),
          ...(ctaVal?.leadGenFormId && {
            lead_gen_form_id: ctaVal.leadGenFormId,
          }),
          ...(ctaVal?.appDestination && {
            app_destination: ctaVal.appDestination,
          }),
        },
      };
    }
    if (config.objectStorySpec.videoData.pageWelcomeMessage) {
      videoData.page_welcome_message =
        config.objectStorySpec.videoData.pageWelcomeMessage;
    }

    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.name,
          object_story_spec: {
            page_id: config.objectStorySpec.pageId,
            ...(config.objectStorySpec.instagramActorId && {
              instagram_user_id: config.objectStorySpec.instagramActorId,
            }),
            video_data: videoData,
          },
          ...(config.degreesOfFreedomSpec && {
            degrees_of_freedom_spec: config.degreesOfFreedomSpec,
          }),
          ...(config.assetFeedSpec && {
            asset_feed_spec: config.assetFeedSpec,
          }),
        }),
      }
    );

    return this.requireId(data, 'ad creative');
  }

  /**
   * Create an ad creative from an existing published post.
   * Uses effective_object_story_id instead of building new creative from scratch.
   * @param config Creative name and the story ID ({pageId}_{postId})
   * @returns Creative ID
   */
  async createAdCreativeFromPost(config: {
    name: string;
    effectiveObjectStoryId: string;
  }): Promise<string> {
    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.name,
          object_story_id: config.effectiveObjectStoryId,
        }),
      }
    );

    return this.requireId(data, 'ad creative');
  }

  /**
   * Get an ad creative's details (for debugging/verification)
   * @param creativeId Creative ID
   * @returns Creative data including status
   */
  async getCreative(creativeId: string): Promise<{
    id: string;
    name?: string;
    status?: string;
    object_story_spec?: Record<string, unknown>;
  }> {
    return this.apiRequest(
      `/${creativeId}?fields=id,name,status,object_story_spec`
    );
  }

  /**
   * Delete an ad creative
   * @param creativeId Creative ID
   */
  async deleteAdCreative(creativeId: string): Promise<void> {
    await this.apiRequest(`/${creativeId}`, { method: 'DELETE' });
  }

  // ==================== AD MANAGEMENT ====================

  /**
   * Create an ad
   * @param config Ad configuration
   * @returns Ad ID
   */
  async createAd(config: MetaAdConfig): Promise<string> {
    // For multi-destination messaging ads, Meta requires degrees_of_freedom_spec
    // to be passed inside the creative object at the ad level, not just on the
    // standalone creative.
    const creative: Record<string, unknown> = {
      creative_id: config.creativeId,
    };
    if (config.degreesOfFreedomSpec) {
      creative.degrees_of_freedom_spec = config.degreesOfFreedomSpec;
    }

    const data = await this.apiRequest<{ id: string }>(
      `/${this.adAccountId}/ads`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.name,
          adset_id: config.adSetId,
          creative,
          status: config.status,
        }),
      }
    );

    return this.requireId(data, 'ad');
  }

  /**
   * Get ad details
   * @param adId Ad ID
   * @returns Ad data
   */
  async getAd(adId: string): Promise<MetaAdData> {
    const data = await this.apiRequest<{
      id: string;
      name: string;
      status: string;
      effective_status: string;
      created_time?: string;
      updated_time?: string;
      creative?: MetaCreativePreviewFields & {
        effective_object_story_id?: string;
      };
    }>(
      `/${adId}?fields=id,name,status,effective_status,created_time,updated_time,creative{thumbnail_url,image_url,effective_object_story_id,object_story_spec}`
    );

    const storyId = data.creative?.effective_object_story_id;

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      effectiveStatus: data.effective_status,
      createdTime: data.created_time,
      updatedTime: data.updated_time,
      thumbnailUrl: pickCreativePreviewUrl(data.creative),
      permalinkUrl: storyId ? `https://www.facebook.com/${storyId}` : undefined,
    };
  }

  /**
   * Get the permanent permalink for an ad post on Facebook.
   * Fetches the creative's effective_object_story_id and constructs a URL.
   * @param adId Meta Ad ID
   * @returns Facebook post URL, or null if not available
   */
  /**
   * Fetch the minimal fields needed to lazily import a single ad into
   * `meta_ad` on a CTM/CTWA referral miss — crucially including the campaign
   * id (which `getAd` omits). See docs/implementations/ctm-ad-lazy-import.md.
   */
  async getAdForImport(adId: string): Promise<MetaAdImportFields> {
    const data = await this.apiRequest<{
      id: string;
      name: string;
      effective_status: string;
      campaign?: { id?: string };
      adset?: { id?: string };
    }>(`/${adId}?fields=id,name,effective_status,campaign{id},adset{id}`);

    return {
      id: data.id,
      name: data.name,
      effectiveStatus: data.effective_status,
      campaignId: data.campaign?.id,
      adSetId: data.adset?.id,
    };
  }

  async getAdPermalink(adId: string): Promise<string | null> {
    const data = await this.apiRequest<{
      id: string;
      creative?: { effective_object_story_id?: string };
    }>(`/${adId}?fields=id,creative{effective_object_story_id}`);

    const storyId = data.creative?.effective_object_story_id;
    if (!storyId) return null;

    return `https://www.facebook.com/${storyId}`;
  }

  /**
   * Update an ad
   * @param adId Ad ID
   * @param updates Updates to apply
   */
  async updateAd(
    adId: string,
    updates: {
      status?: string;
      name?: string;
      creative?: { creative_id: string };
    }
  ): Promise<void> {
    await this.apiRequest(`/${adId}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(updates.status && { status: updates.status }),
        ...(updates.name && { name: updates.name }),
        ...(updates.creative && { creative: updates.creative }),
      }),
    });
  }

  /**
   * Delete an ad
   * @param adId Ad ID
   */
  async deleteAd(adId: string): Promise<void> {
    await this.apiRequest(`/${adId}`, { method: 'DELETE' });
  }

  // ==================== INSIGHTS ====================

  /**
   * Get insights for a campaign
   * @param campaignId Campaign ID
   * @param dateRange Date range for insights
   * @returns Array of insights data
   */
  async getCampaignInsights(
    campaignId: string,
    dateRange: { since: string; until: string }
  ): Promise<MetaInsightsData[]> {
    const fields = [
      'ad_id',
      'ad_name',
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'frequency',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p100_watched_actions',
      'actions',
      'date_start',
      'date_stop',
    ].join(',');

    const data = await this.apiRequest<{ data: MetaInsightsData[] }>(
      `/${campaignId}/insights?fields=${fields}&time_range=${JSON.stringify(dateRange)}&level=ad`
    );

    return data.data || [];
  }

  /**
   * Get insights for a specific ad
   * @param adId Ad ID
   * @param dateRange Date range for insights
   * @returns Insights data or null
   */
  async getAdInsights(
    adId: string,
    dateRange: { since: string; until: string }
  ): Promise<MetaInsightsData | null> {
    const fields = [
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'frequency',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p100_watched_actions',
      'actions',
      'date_start',
      'date_stop',
    ].join(',');

    const data = await this.apiRequest<{ data: MetaInsightsData[] }>(
      `/${adId}/insights?fields=${fields}&time_range=${JSON.stringify(dateRange)}`
    );

    return data.data?.[0] || null;
  }

  /**
   * Get daily breakdown of insights for a specific ad
   * Used for trend analysis and burnout detection
   * @param adId Ad ID
   * @param dateRange Date range for insights
   * @returns Array of daily insights data
   */
  async getAdInsightsDaily(
    adId: string,
    dateRange: { since: string; until: string }
  ): Promise<MetaInsightsData[]> {
    const fields = [
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'frequency',
      'actions',
      'date_start',
      'date_stop',
    ].join(',');

    const data = await this.apiRequest<{ data: MetaInsightsData[] }>(
      `/${adId}/insights?fields=${fields}&time_range=${JSON.stringify(dateRange)}&time_increment=1`
    );

    return data.data || [];
  }

  /**
   * List all active ads for the ad account
   * @param limit Maximum number of ads to return
   * @returns Array of ad data with campaign info
   */
  async listActiveAds(
    limit = 50
  ): Promise<
    Array<MetaAdData & { campaignId?: string; campaignName?: string }>
  > {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        created_time?: string;
        updated_time?: string;
        campaign?: { id: string; name: string };
      }>;
    }>(
      `/${this.adAccountId}/ads?fields=id,name,status,effective_status,created_time,updated_time,campaign{id,name}&filtering=[{"field":"status","operator":"IN","value":["ACTIVE","PENDING_REVIEW"]}]&limit=${limit}`
    );

    return (data.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      createdTime: ad.created_time,
      updatedTime: ad.updated_time,
      campaignId: ad.campaign?.id,
      campaignName: ad.campaign?.name,
    }));
  }

  /**
   * List all non-deleted ads for the ad account (all statuses).
   * Used by syncAllAds to detect ads that were deleted from Meta.
   * Meta does not return truly DELETED ads, so any local ad not in
   * this response can be considered deleted.
   * @param limit Maximum number of ads to return
   * @returns Array of ad data with campaign info
   */
  async listAllAds(
    limit = 100
  ): Promise<
    Array<MetaAdData & { campaignId?: string; campaignName?: string }>
  > {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        created_time?: string;
        updated_time?: string;
        campaign?: { id: string; name: string };
        creative?: MetaCreativePreviewFields & {
          effective_object_story_id?: string;
        };
      }>;
    }>(
      `/${this.adAccountId}/ads?fields=id,name,status,effective_status,created_time,updated_time,campaign{id,name},creative{thumbnail_url,image_url,effective_object_story_id,object_story_spec}&limit=${limit}`
    );

    return (data.data || []).map((ad) => {
      const storyId = ad.creative?.effective_object_story_id;
      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effectiveStatus: ad.effective_status,
        createdTime: ad.created_time,
        updatedTime: ad.updated_time,
        thumbnailUrl: pickCreativePreviewUrl(ad.creative),
        permalinkUrl: storyId
          ? `https://www.facebook.com/${storyId}`
          : undefined,
        campaignId: ad.campaign?.id,
        campaignName: ad.campaign?.name,
      };
    });
  }

  /**
   * List all non-deleted ads with creative data (for importing).
   * Expands creative fields to include title, body, link_url, call_to_action, thumbnail_url.
   * @param limit Maximum number of ads to return
   * @returns Array of ad data with creative details
   */
  async listAllAdsWithCreative(limit = 100): Promise<MetaAdWithCreative[]> {
    const fields = [
      'id',
      'name',
      'status',
      'effective_status',
      'created_time',
      'updated_time',
      'campaign{id,name}',
      'adset_id',
      'creative{id,title,body,link_url,call_to_action_type,thumbnail_url,image_url,object_story_spec}',
    ].join(',');

    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        created_time?: string;
        updated_time?: string;
        campaign?: { id: string; name: string };
        adset_id?: string;
        creative?: MetaCreativePreviewFields & {
          id: string;
          title?: string;
          body?: string;
          link_url?: string;
          call_to_action_type?: string;
          object_story_spec?: {
            video_data?: {
              video_id?: string;
              image_url?: string;
              link_description?: string;
              title?: string;
              message?: string;
            };
            link_data?: {
              picture?: string;
              name?: string;
              message?: string;
              description?: string;
              link?: string;
            };
          };
        };
      }>;
    }>(`/${this.adAccountId}/ads?fields=${fields}&limit=${limit}`);

    return (data.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      createdTime: ad.created_time,
      updatedTime: ad.updated_time,
      campaignId: ad.campaign?.id,
      campaignName: ad.campaign?.name,
      adsetId: ad.adset_id,
      creative: ad.creative
        ? {
            id: ad.creative.id,
            ...readCreativeCopy(ad.creative),
            callToActionType: ad.creative.call_to_action_type,
            thumbnailUrl: pickCreativePreviewUrl(ad.creative),
            videoId: ad.creative.object_story_spec?.video_data?.video_id,
          }
        : undefined,
    }));
  }

  /**
   * List ads for a specific campaign with creative data.
   * Uses /{campaignId}/ads endpoint to scope to a single campaign.
   * @param campaignId Meta campaign ID
   * @param limit Maximum number of ads to return
   * @returns Array of ad data with creative details
   */
  async listCampaignAdsWithCreative(
    campaignId: string,
    limit = 100
  ): Promise<MetaAdWithCreative[]> {
    const fields = [
      'id',
      'name',
      'status',
      'effective_status',
      'created_time',
      'updated_time',
      'adset_id',
      'creative{id,title,body,link_url,call_to_action_type,thumbnail_url,image_url,object_story_spec}',
    ].join(',');

    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        created_time?: string;
        updated_time?: string;
        adset_id?: string;
        creative?: MetaCreativePreviewFields & {
          id: string;
          title?: string;
          body?: string;
          link_url?: string;
          call_to_action_type?: string;
          object_story_spec?: {
            video_data?: {
              video_id?: string;
              image_url?: string;
              link_description?: string;
              title?: string;
              message?: string;
            };
            link_data?: {
              picture?: string;
              name?: string;
              message?: string;
              description?: string;
              link?: string;
            };
          };
        };
      }>;
    }>(`/${campaignId}/ads?fields=${fields}&limit=${limit}`);

    return (data.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      createdTime: ad.created_time,
      updatedTime: ad.updated_time,
      campaignId,
      adsetId: ad.adset_id,
      creative: ad.creative
        ? {
            id: ad.creative.id,
            ...readCreativeCopy(ad.creative),
            callToActionType: ad.creative.call_to_action_type,
            thumbnailUrl: pickCreativePreviewUrl(ad.creative),
            videoId: ad.creative.object_story_spec?.video_data?.video_id,
          }
        : undefined,
    }));
  }

  /**
   * Get aggregate insights for all ads in a campaign
   * @param campaignId Campaign ID
   * @param dateRange Date range for insights
   * @returns Aggregated insights
   */
  async getCampaignAggregateInsights(
    campaignId: string,
    dateRange: { since: string; until: string }
  ): Promise<MetaInsightsData | null> {
    const fields = [
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'frequency',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p100_watched_actions',
      'actions',
    ].join(',');

    const data = await this.apiRequest<{ data: MetaInsightsData[] }>(
      `/${campaignId}/insights?fields=${fields}&time_range=${JSON.stringify(dateRange)}`
    );

    return data.data?.[0] || null;
  }

  /**
   * Get campaign-level insights for the entire ad account in a single request.
   *
   * Returns one row per campaign that had delivery in the date range —
   * campaigns with no delivery in the window are simply absent. This replaces
   * N per-campaign `getCampaignAggregateInsights` calls with one account-level
   * call: the difference between hitting Meta's rate limit on a busy
   * advertising page and not.
   *
   * @param dateRange Date range for insights
   * @returns Array of campaign-level insights, each tagged with `campaign_id`
   */
  async getAccountCampaignInsights(dateRange: {
    since: string;
    until: string;
  }): Promise<MetaInsightsData[]> {
    const fields = [
      'campaign_id',
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'frequency',
      'actions',
    ].join(',');

    const data = await this.apiRequest<{ data: MetaInsightsData[] }>(
      `/${this.adAccountId}/insights?fields=${fields}&time_range=${JSON.stringify(dateRange)}&level=campaign&limit=500`
    );

    return data.data || [];
  }

  // ==================== UTILITY ====================

  /**
   * List all campaigns for the ad account
   * @param limit Maximum number of campaigns to return
   * @returns Array of campaign data
   */
  async listCampaigns(limit = 25): Promise<MetaCampaignData[]> {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        objective: string;
        daily_budget?: string;
        lifetime_budget?: string;
        created_time?: string;
        updated_time?: string;
      }>;
    }>(
      `/${this.adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time&limit=${limit}`
    );

    return (data.data || []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      effectiveStatus: campaign.effective_status,
      objective: campaign.objective,
      dailyBudget: campaign.daily_budget,
      lifetimeBudget: campaign.lifetime_budget,
      createdTime: campaign.created_time,
      updatedTime: campaign.updated_time,
    }));
  }

  /**
   * List ad sets for a campaign
   * @param campaignId Meta campaign ID
   * @returns Array of ad set data
   */
  async listAdSets(campaignId: string): Promise<MetaAdSetData[]> {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        campaign_id: string;
        destination_type?: string;
      }>;
    }>(
      `/${campaignId}/adsets?fields=id,name,status,effective_status,campaign_id,destination_type`
    );

    return (data.data || []).map((adSet) => ({
      id: adSet.id,
      name: adSet.name,
      status: adSet.status,
      effectiveStatus: adSet.effective_status,
      campaignId: adSet.campaign_id,
      destinationType: adSet.destination_type,
    }));
  }

  /**
   * Get full configuration for an ad set — targeting, promoted object,
   * destination type and optimization goal. Used when backfilling a local
   * `metaCampaignConfig` for a campaign that was created directly on Meta
   * (imported), so we can infer the follow-up type and reuse the audience.
   * @param adSetId Meta ad set ID
   */
  async getAdSetDetails(adSetId: string): Promise<{
    id: string;
    name: string;
    destinationType?: string;
    optimizationGoal?: string;
    billingEvent?: string;
    targeting?: Record<string, unknown>;
    promotedObject?: Record<string, unknown>;
  }> {
    const data = await this.apiRequest<{
      id: string;
      name: string;
      destination_type?: string;
      optimization_goal?: string;
      billing_event?: string;
      targeting?: Record<string, unknown>;
      promoted_object?: Record<string, unknown>;
    }>(
      `/${adSetId}?fields=id,name,destination_type,optimization_goal,billing_event,targeting,promoted_object`
    );

    return {
      id: data.id,
      name: data.name,
      destinationType: data.destination_type,
      optimizationGoal: data.optimization_goal,
      billingEvent: data.billing_event,
      targeting: data.targeting,
      promotedObject: data.promoted_object,
    };
  }

  // ==================== COPY (DUPLICATE) ====================

  /**
   * Deep-copy a campaign on Meta using the `/copies` edge. Meta duplicates
   * the campaign and (with `deepCopy`) all of its child ad sets, ads and
   * creatives server-side in a single call — far more robust than rebuilding
   * each creative, and it works for imported ads whose source media we don't
   * hold locally.
   *
   * @param campaignId Source Meta campaign ID
   * @param options.deepCopy Copy all child ad sets + ads (default true)
   * @param options.statusOption Status for the copy (default PAUSED so the
   *   duplicate never spends before the user reviews it)
   * @param options.renameSuffix Suffix appended to the new campaign name
   * @returns The new campaign ID and the source→copied object id mapping
   */
  async copyCampaign(
    campaignId: string,
    options: {
      deepCopy?: boolean;
      statusOption?: 'ACTIVE' | 'PAUSED' | 'INHERITED_FROM_SOURCE';
      renameSuffix?: string;
    } = {}
  ): Promise<{
    copiedCampaignId: string;
    adObjectIds: Array<{
      adObjectType?: string;
      sourceId?: string;
      copiedId?: string;
    }>;
  }> {
    const {
      deepCopy = true,
      statusOption = 'PAUSED',
      renameSuffix = ' (Copy)',
    } = options;

    const data = await this.apiRequest<{
      copied_campaign_id?: string;
      id?: string;
      ad_object_ids?: Array<{
        ad_object_type?: string;
        source_ad_object_id?: string;
        copied_ad_object_id?: string;
      }>;
    }>(`/${campaignId}/copies`, {
      method: 'POST',
      body: JSON.stringify({
        deep_copy: deepCopy,
        status_option: statusOption,
        // ONLY_TOP_LEVEL_RENAME keeps child ad/ad-set names identical to the
        // source so we can map them back; only the campaign gets the suffix.
        rename_options: JSON.stringify({
          rename_strategy: 'ONLY_TOP_LEVEL_RENAME',
          rename_suffix: renameSuffix,
        }),
      }),
    });

    const copiedCampaignId = data.copied_campaign_id ?? data.id;
    if (!copiedCampaignId || typeof copiedCampaignId !== 'string') {
      const error = new Error(
        'Meta API Error: campaign copy returned an invalid response (missing copied_campaign_id)'
      );
      logError('metaAds.copyCampaign', error, {
        feature: 'meta-ads',
        extra: { campaignId, response: data },
      });
      throw error;
    }

    return {
      copiedCampaignId,
      adObjectIds: (data.ad_object_ids ?? []).map((o) => ({
        adObjectType: o.ad_object_type,
        sourceId: o.source_ad_object_id,
        copiedId: o.copied_ad_object_id,
      })),
    };
  }

  /**
   * Copy a single ad set on Meta using the `/copies` edge (shallow — the ad set
   * only, no ads). Optionally places the copy under a different campaign.
   *
   * Used to rebuild a campaign one object at a time, because Meta's synchronous
   * deep-copy rejects copying 3+ ad objects at once.
   *
   * @param adSetId Source Meta ad set ID
   * @param options.campaignId Target campaign for the copy (defaults to source)
   * @param options.statusOption Status for the copy (default PAUSED)
   * @param options.renameSuffix Suffix appended to the new ad set name
   * @returns The new ad set ID
   */
  async copyAdSet(
    adSetId: string,
    options: {
      campaignId?: string;
      statusOption?: 'ACTIVE' | 'PAUSED' | 'INHERITED_FROM_SOURCE';
      renameSuffix?: string;
    } = {}
  ): Promise<{ copiedAdSetId: string }> {
    const {
      campaignId,
      statusOption = 'PAUSED',
      renameSuffix = ' (Copy)',
    } = options;

    const data = await this.apiRequest<{
      copied_adset_id?: string;
      copied_ad_set_id?: string;
      id?: string;
      ad_object_ids?: Array<{
        ad_object_type?: string;
        copied_ad_object_id?: string;
      }>;
    }>(`/${adSetId}/copies`, {
      method: 'POST',
      body: JSON.stringify({
        deep_copy: false,
        status_option: statusOption,
        ...(campaignId && { campaign_id: campaignId }),
        rename_options: JSON.stringify({ rename_suffix: renameSuffix }),
      }),
    });

    const copiedAdSetId =
      data.copied_adset_id ??
      data.copied_ad_set_id ??
      data.id ??
      data.ad_object_ids?.find((o) => o.ad_object_type === 'adgroupset')
        ?.copied_ad_object_id;
    if (!copiedAdSetId || typeof copiedAdSetId !== 'string') {
      const error = new Error(
        'Meta API Error: ad set copy returned an invalid response (missing copied_adset_id)'
      );
      logError('metaAds.copyAdSet', error, {
        feature: 'meta-ads',
        extra: { adSetId, response: data },
      });
      throw error;
    }

    return { copiedAdSetId };
  }

  /**
   * Copy a single ad on Meta using the `/copies` edge. Works for graphic,
   * video and imported ads (Meta duplicates the creative server-side).
   *
   * @param adId Source Meta ad ID
   * @param options.adSetId Target ad set for the copy (defaults to the source
   *   ad's ad set)
   * @param options.statusOption Status for the copy (default PAUSED)
   * @param options.renameSuffix Suffix appended to the new ad name
   * @returns The new ad ID
   */
  async copyAd(
    adId: string,
    options: {
      adSetId?: string;
      statusOption?: 'ACTIVE' | 'PAUSED' | 'INHERITED_FROM_SOURCE';
      renameSuffix?: string;
    } = {}
  ): Promise<{ copiedAdId: string }> {
    const {
      adSetId,
      statusOption = 'PAUSED',
      renameSuffix = ' (Copy)',
    } = options;

    const data = await this.apiRequest<{
      copied_ad_id?: string;
      ad_id?: string;
      id?: string;
    }>(`/${adId}/copies`, {
      method: 'POST',
      body: JSON.stringify({
        status_option: statusOption,
        ...(adSetId && { adset_id: adSetId }),
        rename_options: JSON.stringify({ rename_suffix: renameSuffix }),
      }),
    });

    const copiedAdId = data.copied_ad_id ?? data.ad_id ?? data.id;
    if (!copiedAdId || typeof copiedAdId !== 'string') {
      const error = new Error(
        'Meta API Error: ad copy returned an invalid response (missing copied_ad_id)'
      );
      logError('metaAds.copyAd', error, {
        feature: 'meta-ads',
        extra: { adId, response: data },
      });
      throw error;
    }

    return { copiedAdId };
  }

  /**
   * Get the page ID for this service
   */
  getPageId(): string {
    return this.pageId;
  }

  /**
   * Get the ad account ID for this service
   */
  getAdAccountId(): string {
    return this.adAccountId;
  }

  // ==================== AD ACCOUNT INFO ====================

  /**
   * Check if the ad account has a valid funding source (payment method).
   * Returns true if the account has a payment method configured.
   */
  async hasPaymentMethod(): Promise<boolean> {
    try {
      const data = await this.apiRequest<{
        funding_source_details?: { type?: number };
      }>(`/${this.adAccountId}?fields=funding_source_details{type}`);
      return data.funding_source_details?.type != null;
    } catch (error) {
      // If we can't check, don't block — let Meta handle it during ad creation
      logError('metaAds.hasPaymentMethod', error, {
        feature: 'meta-ads',
        extra: {
          adAccountId: this.adAccountId,
          ...extractMetaErrorContext(error),
        },
      });
      return true;
    }
  }

  // ==================== AD ACCOUNT HEALTH ====================

  /**
   * Fetch comprehensive ad account health data for pre-launch checks.
   * Returns account status, payment method, spending limits, and currency.
   */
  async getAdAccountHealth(): Promise<{
    accountStatus: number;
    disableReason: number;
    currency: string;
    spendCap: string;
    amountSpent: string;
    hasPaymentMethod: boolean;
    /** True when Meta omits funding_source_details entirely (verification/restriction). */
    fundingDataWithheld: boolean;
  }> {
    const data = await this.apiRequest<{
      account_status: number;
      disable_reason: number;
      currency: string;
      spend_cap: string;
      amount_spent: string;
      funding_source_details?: { type?: number };
    }>(
      `/${this.adAccountId}?fields=account_status,disable_reason,currency,spend_cap,amount_spent,funding_source_details{type}`
    );

    // Meta omits funding_source_details entirely (not even null) when data is
    // withheld due to account verification or similar restrictions.
    const fundingDataWithheld = !('funding_source_details' in data);

    return {
      accountStatus: data.account_status,
      disableReason: data.disable_reason ?? 0,
      currency: data.currency,
      spendCap: data.spend_cap ?? '0',
      amountSpent: data.amount_spent ?? '0',
      hasPaymentMethod: data.funding_source_details?.type != null,
      fundingDataWithheld,
    };
  }

  /**
   * Check if any ACTIVE campaigns have delivery issues caused by the account
   * spending limit being reached. Meta sets effective_status to WITH_ISSUES
   * and populates issues_info when the cap is hit.
   *
   * Returns true if at least one active campaign is blocked by the spending limit.
   */
  async isSpendingLimitReached(): Promise<boolean> {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        effective_status: string;
        issues_info: Array<{ error_code: number; error_message: string }>;
      }>;
    }>(
      `/${this.adAccountId}/campaigns?fields=id,effective_status,issues_info&filtering=[{"field":"effective_status","operator":"IN","value":["WITH_ISSUES"]}]&limit=5`
    );

    if (!data.data?.length) return false;

    // Check if any issue mentions spending limit
    return data.data.some((campaign) =>
      campaign.issues_info?.some(
        (issue) =>
          issue.error_message?.toLowerCase().includes('spending limit') ||
          issue.error_message?.toLowerCase().includes('spend limit') ||
          issue.error_message?.toLowerCase().includes('spend cap')
      )
    );
  }

  /**
   * Check if a Facebook Page is still accessible with the current token.
   * Returns page name and linked Instagram account info.
   */
  async getPageAccess(pageId: string): Promise<{
    id: string;
    name: string;
    instagramBusinessAccount: { id: string } | null;
  }> {
    const data = await this.apiRequest<{
      id: string;
      name: string;
      instagram_business_account?: { id: string };
    }>(`/${pageId}?fields=id,name,instagram_business_account`);

    return {
      id: data.id,
      name: data.name,
      instagramBusinessAccount: data.instagram_business_account ?? null,
    };
  }

  // ==================== PAGE VALIDATION ====================

  /**
   * Get all pages the current token can manage (respects OAuth scope).
   * Uses GET /me/accounts which only returns pages the token has access to.
   */
  async getPages(): Promise<Array<{ id: string; name: string }>> {
    const data = await this.apiRequest<{
      data: Array<{ id: string; name: string }>;
    }>('/me/accounts?fields=id,name&limit=100');
    return data.data || [];
  }

  /**
   * Get specific fields for a Facebook Page.
   * Useful for checking leadgen_tos_accepted before campaign creation.
   */
  async getPageInfo(
    pageId: string,
    fields: string[]
  ): Promise<Record<string, unknown>> {
    const data = await this.apiRequest<Record<string, unknown>>(
      `/${pageId}?fields=${fields.join(',')}`
    );
    return data;
  }

  // ==================== INSTAGRAM ACCOUNT ====================

  /**
   * Check if a linked Instagram account has a profile picture.
   * Meta requires Instagram accounts to have a profile photo before
   * ads can be delivered on Instagram (including via Advantage+ auto-expansion).
   * @param instagramAccountId Instagram Business Account ID
   * @returns Object with hasProfilePicture and account details
   */
  async getInstagramAccountInfo(instagramAccountId: string): Promise<{
    id: string;
    name?: string;
    username?: string;
    hasProfilePicture: boolean;
    profilePictureUrl?: string;
  }> {
    const data = await this.apiRequest<{
      id: string;
      name?: string;
      username?: string;
      profile_picture_url?: string;
    }>(`/${instagramAccountId}?fields=id,name,username,profile_picture_url`);

    return {
      id: data.id,
      name: data.name,
      username: data.username,
      hasProfilePicture: !!data.profile_picture_url,
      profilePictureUrl: data.profile_picture_url,
    };
  }

  // ==================== LEAD FORM MANAGEMENT ====================

  /**
   * Create a lead generation form on a Facebook Page
   * @param config Lead form configuration
   * @returns Created form ID
   */
  async createLeadGenForm(config: MetaLeadFormConfig): Promise<string> {
    // Build questions array for Meta API
    const questions = config.questions.map((q) => {
      const question: Record<string, unknown> = {
        // Meta's enum is its own vocabulary — DATE_OF_BIRTH is DOB there, and
        // sending ours verbatim rejects the entire form.
        type: toMetaQuestionType(q.type),
      };

      // Meta only accepts `label` on CUSTOM questions. Pre-defined fields
      // (FULL_NAME, EMAIL, PHONE, etc.) reject it with:
      // "Parameter label cannot be specified for non-custom questions".
      if (q.type === 'CUSTOM' && q.label) {
        question.label = q.label;
      }

      if (q.type === 'CUSTOM' && q.key) {
        question.key = q.key;
      }

      if (q.options && q.options.length > 0) {
        question.options = q.options;
      }

      return question;
    });

    // "Start conversations on Messenger" is driven by the top-level
    // `is_auto_thread_creation_enabled` flag on the leadgen_forms edge — NOT
    // `thank_you_page.enable_messenger`. We captured the exact POST that Meta
    // Business Suite sends to graph.facebook.com/{page}/leadgen_forms when the
    // "Start conversations on Messenger" checkbox is ticked: it sends
    // `is_auto_thread_creation_enabled: true` alongside a P2B_MESSENGER
    // thank-you button. `enable_messenger` is never sent (it's noise), and the
    // hidden `inbox_url` question is injected by Meta server-side as an EFFECT
    // of this flag — we must not send it ourselves (it renders as a junk field).
    //
    // Requires Open Sharing (block_display_for_non_targeted_viewer = false) AND
    // only Messenger-eligible question types. We keep it on by default and fall
    // back to off rather than letting Meta reject the whole form.
    const messengerEligible = isMessengerEligible(config.questions);
    const enableMessenger =
      (config.thankYouPage?.enableMessenger ?? true) && messengerEligible;

    if (config.thankYouPage?.enableMessenger !== false && !messengerEligible) {
      const offending = [
        ...new Set(
          config.questions
            .map((q) => q.type)
            .filter(
              (t) =>
                !(messengerEligibleQuestionTypes as readonly string[]).includes(
                  t
                )
            )
        ),
      ];
      console.warn(
        `[META] Lead form "${config.name}" cannot auto-start Messenger conversations: question type(s) ${offending.join(', ')} are not Messenger-eligible. Leads will only reach the chatbot if they tap the thank-you-page CTA.`
      );
    }

    // Build the form payload
    const payload: Record<string, unknown> = {
      name: config.name,
      questions: JSON.stringify(questions),
      privacy_policy: JSON.stringify({
        url: config.privacyPolicy.url,
        ...(config.privacyPolicy.linkText && {
          link_text: config.privacyPolicy.linkText,
        }),
      }),
      // Required for Messenger-conversation eligibility ("Open Sharing").
      ...(enableMessenger && { block_display_for_non_targeted_viewer: false }),
      // THE trigger for "Start conversations on Messenger". Meta's own UI sends
      // this exact flag on the leadgen_forms edge; it makes Meta auto-create a
      // Messenger thread (and inject the hidden inbox_url question) when a lead
      // submits and opts in. Without it, a P2B_MESSENGER button alone leaves the
      // checkbox unticked and no conversation is started.
      ...(enableMessenger && { is_auto_thread_creation_enabled: true }),
    };

    // Messenger auto-start = a P2B_MESSENGER thank-you-page button. We always
    // emit a thank-you page when auto-start is on so the button is present.
    if (config.thankYouPage || enableMessenger) {
      const tp = config.thankYouPage ?? {};
      // Resolve the call-to-action button shown on the post-submission screen.
      // Messaging buttons (P2B_MESSENGER / WHATSAPP) power "instant form lead
      // nurturing" — they drop the lead into a chat right after they submit.
      // When Messenger auto-start is on, force P2B_MESSENGER: that button IS
      // what Meta's "Start conversations on Messenger" checkbox produces.
      const buttonType = enableMessenger
        ? 'P2B_MESSENGER'
        : (tp.buttonType ?? (tp.buttonUrl ? 'VIEW_WEBSITE' : 'NONE'));

      // Every non-NONE button requires button_text; Meta rejects the form
      // otherwise ("Button text is missing for Thank You Page").
      const defaultButtonText: Record<string, string> = {
        VIEW_WEBSITE: 'View website',
        P2B_MESSENGER: 'Chat with us',
        WHATSAPP: 'Chat on WhatsApp',
        CALL_BUSINESS: 'Call us',
      };
      const buttonText =
        buttonType === 'NONE'
          ? undefined
          : tp.buttonText || defaultButtonText[buttonType];

      payload.thank_you_page = JSON.stringify({
        title: tp.title || 'Thank you',
        body: tp.body || "We'll be in touch soon.",
        button_type: buttonType,
        ...(buttonText && { button_text: buttonText }),
        // Website CTA
        ...(buttonType === 'VIEW_WEBSITE' &&
          tp.buttonUrl && { website_url: tp.buttonUrl }),
        // WhatsApp CTA requires the business number to open a chat with
        ...(buttonType === 'WHATSAPP' &&
          tp.businessPhoneNumber && {
            business_phone_number: tp.businessPhoneNumber,
          }),
      });
    }

    // Add context card if provided
    if (config.contextCard) {
      payload.context_card = JSON.stringify({
        title: config.contextCard.title,
        content: config.contextCard.content
          ? [config.contextCard.content]
          : undefined,
        button_text: config.contextCard.buttonText,
        style: config.contextCard.style || 'PARAGRAPH_STYLE',
      });
    }

    // Add locale if provided
    if (config.locale) {
      payload.locale = config.locale;
    }

    // Add follow up action if provided
    if (config.followUpActionUrl) {
      payload.follow_up_action_url = config.followUpActionUrl;
    }

    const createForm = () =>
      this.apiRequest<{ id: string }>(`/${this.pageId}/leadgen_forms`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

    // Messenger auto-start (`is_auto_thread_creation_enabled`) is gated behind a
    // Meta app capability — Advanced Access to `pages_messaging`. Apps that lack
    // it get "(#3) Application does not have the capability", and Meta rejects
    // the ENTIRE request, which would otherwise break lead-form creation. When
    // the flag is set and Meta returns #3, drop ONLY that flag and retry once so
    // the form is still created. Messenger auto-start then lights up
    // automatically wherever the capability exists (e.g. a fully-reviewed prod
    // app). Verified against Meta: a byte-identical create succeeds without the
    // flag and #3s with it, on the same page token.
    let data: { id: string };
    try {
      data = await createForm();
    } catch (error) {
      if (
        payload.is_auto_thread_creation_enabled === true &&
        error instanceof MetaApiError &&
        error.code === 3
      ) {
        console.warn(
          `[META] Lead form "${config.name}": Meta rejected is_auto_thread_creation_enabled with "(#3) Application does not have the capability". Creating the form WITHOUT Messenger auto-start — "Start conversations on Messenger" will be OFF until this Meta app is granted Advanced Access to pages_messaging.`
        );
        // Assigning undefined (not `delete`) drops it from the JSON body.
        payload.is_auto_thread_creation_enabled = undefined;
        data = await createForm();
      } else {
        throw error;
      }
    }

    return this.requireId(data, 'lead form');
  }

  /**
   * Get a lead form by ID
   * @param formId Lead form ID
   * @returns Lead form data
   */
  async getLeadGenForm(formId: string): Promise<MetaLeadFormData> {
    const fields = [
      'id',
      'name',
      'status',
      'locale',
      'questions',
      'privacy_policy_url',
      'created_time',
      'page',
    ].join(',');

    const data = await this.apiRequest<{
      id: string;
      name: string;
      status: string;
      locale?: string;
      questions?: Array<{
        type: string;
        label?: string;
        key?: string;
        options?: Array<{ value: string; key?: string }>;
      }>;
      privacy_policy_url?: string;
      created_time?: string;
      page?: { id: string };
    }>(`/${formId}?fields=${fields}`);

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      locale: data.locale,
      questions: data.questions?.map((q) => ({
        type: q.type as MetaLeadFormQuestion['type'],
        label: q.label,
        key: q.key,
        options: q.options,
      })),
      privacyPolicyUrl: data.privacy_policy_url,
      createdTime: data.created_time,
      pageId: data.page?.id,
    };
  }

  /**
   * List all lead forms for the connected page
   * @param limit Maximum number of forms to return
   * @returns Array of lead form data
   */
  async listLeadGenForms(limit = 25): Promise<MetaLeadFormData[]> {
    const fields = ['id', 'name', 'status', 'locale', 'created_time'].join(',');

    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        name: string;
        status: string;
        locale?: string;
        created_time?: string;
      }>;
    }>(`/${this.pageId}/leadgen_forms?fields=${fields}&limit=${limit}`);

    return (data.data || []).map((form) => ({
      id: form.id,
      name: form.name,
      status: form.status,
      locale: form.locale,
      createdTime: form.created_time,
      pageId: this.pageId,
    }));
  }

  /**
   * Delete a lead form (archive)
   * Note: Lead forms cannot be fully deleted, only archived
   * @param formId Lead form ID
   */
  async archiveLeadGenForm(formId: string): Promise<void> {
    await this.apiRequest(`/${formId}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'ARCHIVED' }),
    });
  }

  /**
   * Get leads submitted through a form
   * @param formId Lead form ID
   * @param limit Maximum number of leads to return
   * @returns Array of lead data
   */
  async getFormLeads(formId: string, limit = 50): Promise<MetaLeadData[]> {
    const data = await this.apiRequest<{
      data: Array<{
        id: string;
        field_data: Array<{ name: string; values: string[] }>;
        created_time: string;
        ad_id?: string;
        campaign_id?: string;
      }>;
    }>(`/${formId}/leads?limit=${limit}`);

    return (data.data || []).map((lead) => ({
      id: lead.id,
      formId,
      fieldData: lead.field_data,
      createdTime: lead.created_time,
      adId: lead.ad_id,
      campaignId: lead.campaign_id,
    }));
  }

  /**
   * List every lead form on the connected page, following Graph pagination.
   *
   * `listLeadGenForms` caps at a single page of results, which silently hides
   * forms on pages with a long history — fine for a picker, fatal for the
   * reconciliation poll that must see every form to find every lead.
   */
  async listAllLeadGenForms(
    options: { pageSize?: number; maxPages?: number } = {}
  ): Promise<MetaLeadFormData[]> {
    const { pageSize = 50, maxPages = 20 } = options;
    // `leads_count` is what lets the poll skip a form whose lead total has not
    // moved — one call per page instead of one per form.
    const fields = [
      'id',
      'name',
      'status',
      'locale',
      'created_time',
      'leads_count',
    ].join(',');

    const forms: MetaLeadFormData[] = [];
    let next: string | undefined =
      `/${this.pageId}/leadgen_forms?fields=${fields}&limit=${pageSize}`;

    for (let page = 0; page < maxPages && next; page++) {
      const data: {
        data?: Array<{
          id: string;
          name: string;
          status: string;
          locale?: string;
          created_time?: string;
          leads_count?: number;
        }>;
        paging?: { next?: string };
      } = await this.apiRequest(next);

      for (const form of data.data || []) {
        forms.push({
          id: form.id,
          name: form.name,
          status: form.status,
          locale: form.locale,
          createdTime: form.created_time,
          leadsCount: form.leads_count,
          pageId: this.pageId,
        });
      }

      // Graph returns an absolute `paging.next` that already carries the
      // cursor; apiRequest passes absolute URLs straight through, but it also
      // appends its own access_token/appsecret_proof, so strip Meta's copy to
      // avoid a duplicated parameter.
      next = stripAuthParams(data.paging?.next);
    }

    return forms;
  }

  /**
   * Read leads submitted through a form, newest first, optionally only those
   * created after `since`.
   *
   * This is the pull side of lead capture. It keeps working when Meta withholds
   * `leadgen` webhook delivery for a Page (ENG-786) — read access via the
   * page/user token survives the delivery gate — so it is the floor under the
   * webhook fast path.
   *
   * @param formId Lead form ID
   * @param options.since Only return leads created strictly after this time
   * @param options.pageSize Graph page size
   * @param options.maxPages Safety cap on pages followed
   */
  async getFormLeadsSince(
    formId: string,
    options: { since?: Date; pageSize?: number; maxPages?: number } = {}
  ): Promise<MetaLeadData[]> {
    const { since, pageSize = 100, maxPages = 20 } = options;
    const fields = [
      'id',
      'created_time',
      'ad_id',
      'adgroup_id',
      'campaign_id',
      'field_data',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      limit: String(pageSize),
    });

    if (since) {
      params.set(
        'filtering',
        JSON.stringify([
          {
            field: 'time_created',
            operator: 'GREATER_THAN',
            value: Math.floor(since.getTime() / 1000),
          },
        ])
      );
    }

    const leads: MetaLeadData[] = [];
    let next: string | undefined = `/${formId}/leads?${params.toString()}`;

    for (let page = 0; page < maxPages && next; page++) {
      const data: {
        data?: Array<{
          id: string;
          field_data?: Array<{ name: string; values?: string[] }>;
          created_time: string;
          ad_id?: string | null;
          campaign_id?: string | null;
        }>;
        paging?: { next?: string };
      } = await this.apiRequest(next);

      for (const lead of data.data || []) {
        leads.push({
          id: lead.id,
          formId,
          fieldData: lead.field_data ?? [],
          createdTime: lead.created_time,
          adId: lead.ad_id ?? undefined,
          campaignId: lead.campaign_id ?? undefined,
        });
      }

      next = stripAuthParams(data.paging?.next);
    }

    return leads;
  }

  /**
   * Subscribe to lead notifications via webhook
   * @param formId Lead form ID
   * @param callbackUrl Webhook callback URL
   */
  async subscribeToLeadNotifications(
    _formId: string,
    _callbackUrl: string
  ): Promise<void> {
    await this.apiRequest(`/${this.pageId}/subscribed_apps`, {
      method: 'POST',
      body: JSON.stringify({
        subscribed_fields: metaPageSubscribedFields,
      }),
    });
  }

  /**
   * Get details of a specific lead by leadgen_id
   * This is used when processing webhook notifications
   * @param leadgenId The lead ID from the webhook
   * @returns Lead data with all field values, or null if not found
   */
  async getLeadDetails(leadgenId: string): Promise<MetaLeadData> {
    try {
      const data = await this.apiRequest<{
        id: string;
        field_data: Array<{ name: string; values: string[] }>;
        created_time: string;
        form_id?: string;
        ad_id?: string;
        campaign_id?: string;
      }>(
        `/${leadgenId}?fields=id,field_data,created_time,form_id,ad_id,campaign_id`
      );

      return {
        id: data.id,
        formId: data.form_id || '',
        fieldData: data.field_data,
        createdTime: data.created_time,
        adId: data.ad_id,
        campaignId: data.campaign_id,
      };
    } catch (error) {
      // Expected conditions (dead token → 190, deleted/unpermissioned lead →
      // 100/33) log at warn; only genuinely unclassified errors go to Sentry.
      // The error is rethrown so the caller can triage per capability (e.g.
      // the leadgen webhook marks the page dead for the rest of the run on an
      // auth error, but still attempts other pages' leads).
      logMetaApiError('metaAds.getLeadDetails', error, { leadgenId });
      throw error;
    }
  }
}
