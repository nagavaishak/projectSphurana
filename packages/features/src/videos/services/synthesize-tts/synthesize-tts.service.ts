import { createHash, randomUUID } from 'node:crypto';
import {
  type Database,
  and,
  audioAsset,
  eq,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  getOrgAssetsBucket,
  getPublicCdnUrl,
  isCdnEnabled,
  upload,
} from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SynthesizeTtsInput,
  type SynthesizeTtsOutput,
  synthesizeTtsSchema,
} from './synthesize-tts.schema.js';

// Cache lookup → returns the persisted audio_asset row when present.
async function findCached(
  db: Database,
  organizationId: string,
  hash: string
): Promise<{ url: string; durationMs: number | null } | null> {
  const row = await db.query.audioAsset.findFirst({
    where: and(
      eq(audioAsset.organizationId, organizationId),
      eq(audioAsset.kind, 'tts'),
      eq(audioAsset.hash, hash)
    ),
    columns: { url: true, durationMs: true },
  });
  if (!row?.url) return null;
  return { url: row.url, durationMs: row.durationMs };
}

interface ProviderResult {
  /** Raw audio bytes (wav). */
  audio: Buffer;
  /** Audio length in milliseconds (provider's best estimate). */
  durationMs: number;
}

// Shape we use from video-processing's TTS engine. Imported dynamically via a
// non-literal specifier so the features package needn't take a static build
// dependency on video-processing (which would pull ffmpeg into this package's
// graph) — mirrors the provider note in synthesize-captions. Resolves at
// runtime in the worker, which already depends on video-processing.
interface TtsEngineModule {
  isTtsReady(): boolean;
  initTts(options: { elevenLabsApiKey?: string }): void;
  generateTts(
    text: string,
    voice: string
  ): Promise<{ audio: ArrayBuffer; audioLength: number }>;
}

// Primary (and only) provider: ElevenLabs, via the shared video-processing
// engine. Returns null when the key is missing or the API call fails so the
// caller can fall back to a deterministic stub.
async function generateElevenLabsAudio(
  script: string,
  voice: string
): Promise<ProviderResult | null> {
  const { voiceEnv } = await import('@borradh-workspace/env/voice');
  const apiKey = voiceEnv.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    // Widened to `string` so tsc treats the import as runtime-only (no static
    // module resolution / no required dependency).
    const specifier: string = '@borradh-workspace/video-processing/tts';
    const tts = (await import(specifier)) as TtsEngineModule;
    if (!tts.isTtsReady()) {
      tts.initTts({ elevenLabsApiKey: apiKey });
    }
    const result = await tts.generateTts(script, voice);
    return {
      audio: Buffer.from(result.audio),
      durationMs: Math.round(result.audioLength * 1000),
    };
  } catch (error) {
    logError('videos.synthesizeTts.elevenlabs', error, { feature: 'videos' });
    return null;
  }
}

// TTS provider chain: ElevenLabs is the engine; a deterministic stub is the
// last resort so downstream stays unblocked when TTS is unavailable.
async function generateTtsAudio(
  script: string,
  voice: string
): Promise<ProviderResult | { stub: true; durationMs: number }> {
  const elevenLabs = await generateElevenLabsAudio(script, voice);
  if (elevenLabs) return elevenLabs;

  const estimatedSeconds = Math.max(1, script.length / 12);
  return { stub: true, durationMs: Math.round(estimatedSeconds * 1000) };
}

function hashScriptVoice(script: string, voice: string): string {
  return createHash('sha256').update(`${script}\x00${voice}`).digest('hex');
}

function buildPublicUrl(key: string): string {
  if (isCdnEnabled()) return getPublicCdnUrl(key);
  // Fall back to a raw S3 key reference; the worker's presigner will rewrite
  // this at compile time. (See compileRenderDoc → presignS3UrlIfNeeded.)
  return key;
}

const synthesizeTtsImpl = async (
  db: Database,
  input: SynthesizeTtsInput
): Promise<Result<SynthesizeTtsOutput>> => {
  const parsed = synthesizeTtsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid synthesize-tts input',
        {
          issues: parsed.error.issues,
        }
      )
    );
  }

  const { organizationId, script, voice, fps } = parsed.data;
  const hash = hashScriptVoice(script, voice);

  const cached = await findCached(db, organizationId, hash);
  if (cached) {
    const durationMs = cached.durationMs ?? 0;
    return ok({
      url: cached.url,
      durationFrames: Math.max(1, Math.round((durationMs / 1000) * fps)),
      durationMs,
      hash,
      cached: true,
    });
  }

  try {
    const result = await generateTtsAudio(script, voice);

    // Stub path: the stub is a transient "stay unblocked" fallback for when
    // TTS is unavailable (missing key, provider error). We deliberately DO NOT
    // persist it — caching a `tts-stub://` row keyed by (script, voice) would
    // poison that hash forever, so a momentary outage would permanently
    // degrade every later render of the same script+voice to silent audio +
    // a single full-length caption page, even after the key is restored.
    // Returning it un-cached means the next render simply re-attempts real TTS.
    if ('stub' in result) {
      const stubKey = `tts-stub://${organizationId}/${hash}.wav`;
      return ok({
        url: stubKey,
        durationFrames: Math.max(
          1,
          Math.round((result.durationMs / 1000) * fps)
        ),
        durationMs: result.durationMs,
        hash,
        cached: false,
      });
    }

    const s3Key = `${organizationId}/synthesized-audio/tts/${hash}.wav`;
    const bucket = getOrgAssetsBucket();
    await upload({
      bucket,
      key: s3Key,
      body: result.audio,
      contentType: 'audio/wav',
    });

    const url = buildPublicUrl(s3Key);
    await db.insert(audioAsset).values({
      id: randomUUID(),
      kind: 'tts',
      hash,
      url,
      durationMs: result.durationMs,
      payload: JSON.stringify({ voice, bucket }),
      organizationId,
    });

    return ok({
      url,
      durationFrames: Math.max(1, Math.round((result.durationMs / 1000) * fps)),
      durationMs: result.durationMs,
      hash,
      cached: false,
    });
  } catch (error) {
    logError('videos.synthesizeTts', error, {
      feature: 'videos',
      extra: { organizationId, voice, hash },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to synthesize TTS audio'
      )
    );
  }
};

export const synthesizeTts = (db: Database, input: SynthesizeTtsInput) =>
  trackedResult('videos.synthesizeTts', () => synthesizeTtsImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      voice: input.voice ?? 'alloy',
    },
  });

export type SynthesizeTtsResult = Awaited<ReturnType<typeof synthesizeTts>>;
