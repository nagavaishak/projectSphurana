import sharp from 'sharp';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { MetaApiError } from '../shared/meta-api-error.js';
import { MetaAdsService } from './meta-ads.service.js';

/** A red square encoded in a given format, used as upload input. */
async function makeImage(
  format: 'webp' | 'png' | 'jpeg' | 'gif'
): Promise<Buffer> {
  const base = sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  });
  if (format === 'webp') return base.webp().toBuffer();
  if (format === 'png') return base.png().toBuffer();
  if (format === 'jpeg') return base.jpeg().toBuffer();
  return base.gif().toBuffer();
}

/** Mock the S3 download leg (fetchWithRetry). */
function downloadResponse(buf: Buffer, contentType: string): Response {
  const arrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => arrayBuffer,
  } as unknown as Response;
}

/** Mock a successful Meta /adimages response. */
function uploadOkResponse(hash = 'hash-abc'): Response {
  const body = { images: { 'image.png': { hash } } };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Mock a Meta /adimages error response. */
function uploadErrorResponse(
  code = 100,
  message = 'Invalid parameter',
  subcode?: number
): Response {
  const body = {
    error: { message, code, type: 'OAuthException', error_subcode: subcode },
  };
  return {
    ok: false,
    status: 400,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('MetaAdsService.uploadImage', () => {
  let service: MetaAdsService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let webp: Buffer;
  let png: Buffer;
  let jpeg: Buffer;

  beforeAll(async () => {
    [webp, png, jpeg] = await Promise.all([
      makeImage('webp'),
      makeImage('png'),
      makeImage('jpeg'),
    ]);
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    service = new MetaAdsService({
      accessToken: 'token',
      adAccountId: 'act_1',
      pageId: 'page-1',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The multipart body sent to Meta on the upload (2nd) fetch call. */
  function uploadBody(): string {
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    return (init.body as Buffer).toString('latin1');
  }

  it('transcodes a WebP image to PNG before uploading to Meta', async () => {
    fetchMock
      .mockResolvedValueOnce(downloadResponse(webp, 'image/webp'))
      .mockResolvedValueOnce(uploadOkResponse());

    const result = await service.uploadImage('https://s3.example/img.webp');

    expect(result).toEqual({ imageHash: 'hash-abc' });
    const body = uploadBody();
    expect(body).toContain('filename="image.png"');
    expect(body).toContain('Content-Type: image/png');
    expect(body).not.toContain('image/webp');
    // The uploaded bytes must be a valid PNG (magic number \x89PNG).
    expect(body).toContain('\x89PNG');
  });

  it('uploads a PNG image without transcoding', async () => {
    fetchMock
      .mockResolvedValueOnce(downloadResponse(png, 'image/png'))
      .mockResolvedValueOnce(uploadOkResponse());

    const result = await service.uploadImage('https://s3.example/img.png');

    expect(result).toEqual({ imageHash: 'hash-abc' });
    expect(uploadBody()).toContain('Content-Type: image/png');
  });

  it('detects a JPEG even when the Content-Type header is wrong', async () => {
    // S3 hands back octet-stream, but the bytes are a JPEG.
    fetchMock
      .mockResolvedValueOnce(downloadResponse(jpeg, 'application/octet-stream'))
      .mockResolvedValueOnce(uploadOkResponse());

    await service.uploadImage('https://s3.example/img.bin');

    const body = uploadBody();
    expect(body).toContain('Content-Type: image/jpeg');
    expect(body).toContain('filename="image.jpg"');
  });

  it('throws a MetaApiError carrying Meta code/subcode on rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(downloadResponse(png, 'image/png'))
      .mockResolvedValueOnce(
        uploadErrorResponse(100, 'Invalid parameter', 1234)
      );

    const error = await service
      .uploadImage('https://s3.example/img.png')
      .catch((e: unknown) => e);

    // An instance of MetaApiError so handleMetaError can classify it, carrying
    // Meta's code/subcode/message instead of a bare "Invalid parameter".
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ code: 100, subcode: 1234 });
    expect(String((error as Error).message)).toContain('Invalid parameter');
  });
});
