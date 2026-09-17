import { createHash, randomUUID } from 'node:crypto';
import {
  type Database,
  and,
  audioAsset,
  eq,
} from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  downloadAsBuffer,
  getOrgAssetsBucket,
  parseS3Url,
} from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SynthesizeCaptionsInput,
  type SynthesizeCaptionsOutput,
  type SynthesizedCaptionPage,
  type SynthesizedCaptionWord,
  synthesizeCaptionsSchema,
} from './synthesize-captions.schema.js';

interface WhisperWord {
  word: string;
  start: number; // seconds
  end: number;
}

interface ProviderResult {
  /** Word-level timestamps from Whisper, in seconds. */
  words: WhisperWord[];
  /** Total duration of the audio in seconds. */
  durationSec: number;
}

// Caption cache key folds in editedText so an aligned request never serves a
// raw-transcription cache entry (or vice versa) for the same audio.
function hashKey(audioUrl: string, editedText?: string): string {
  return createHash('sha256')
    .update(audioUrl)
    .update('\x00')
    .update(editedText ?? '')
    .digest('hex');
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

function framesToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

// Whisper words are in seconds; normalize to ms words for downstream packing.
function whisperWordsToMs(words: WhisperWord[]): SynthesizedCaptionWord[] {
  return words
    .map((w) => ({
      text: w.word.trim(),
      startMs: Math.max(0, Math.round(w.start * 1000)),
      endMs: Math.max(0, Math.round(w.end * 1000)),
    }))
    .filter((w) => w.text.length > 0);
}

// Replace transcription text with user/script text while keeping Whisper timing.
// Ported from v1's alignEditedCaptions (caption-builder.ts), adapted to ms words.
//
// CRITICAL: the substitution is positional (editedWord[i] ← whisperWord[i]
// timing). That is only sound when the two token streams line up 1:1. When the
// script's word count differs from what Whisper transcribed — placeholders like
// "[CLINIC NAME]", hyphenates ("Stoke-on-Trent"), numbers, or punctuation that
// Whisper splits/merges differently — every word past the first divergence
// inherits the wrong timing, so the highlight wanders ahead of / behind the
// voice. In that case we keep the RAW Whisper words: their text is ground-truth
// aligned to the audio, so the highlight always tracks the spoken word (the
// only cost is Whisper's spelling of brand names). We only substitute the clean
// script text when the counts match exactly and the mapping is provably safe.
function alignEditedWords(
  words: SynthesizedCaptionWord[],
  editedText: string
): SynthesizedCaptionWord[] {
  const editedWords = editedText.trim().split(/\s+/).filter(Boolean);
  if (editedWords.length === 0) return words;
  if (words.length === 0) return [];

  // Counts diverge → positional alignment is unreliable. Trust Whisper's own
  // word timings (and text) so captions stay synced to the audio.
  if (editedWords.length !== words.length) {
    return words;
  }

  // 1:1 — safe to swap in the clean script text on each Whisper timing slot.
  return editedWords.map((text, i) => ({
    text,
    startMs: words[i].startMs,
    endMs: words[i].endMs,
  }));
}

// Group words into TikTok pages — v1 cadence: break on word count, page
// duration, or sentence punctuation. Emits per-word ms timing + frame bounds.
function packWords(
  words: SynthesizedCaptionWord[],
  fps: number,
  maxWordsPerPage: number,
  maxPageDurationMs: number,
  minGapFrames: number
): SynthesizedCaptionPage[] {
  if (words.length === 0) return [];

  const pages: SynthesizedCaptionPage[] = [];
  let current: SynthesizedCaptionWord[] = [];
  let pageStartMs = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    pages.push({
      fromFrame: Math.max(0, msToFrames(first.startMs, fps)),
      toFrame: Math.max(1, msToFrames(last.endMs, fps) + minGapFrames),
      text: current.map((w) => w.text).join(' '),
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    const isFirst = current.length === 0;
    if (isFirst) pageStartMs = word.startMs;

    const pageDuration = word.endMs - pageStartMs;
    const wordCount = current.length + 1;
    const endsWithPunctuation = /[.!?]$/.test(word.text);
    const shouldBreak =
      wordCount > maxWordsPerPage ||
      pageDuration > maxPageDurationMs ||
      (endsWithPunctuation && wordCount >= 2);

    if (shouldBreak && !isFirst) {
      flush();
      current = [word];
      pageStartMs = word.startMs;
    } else {
      current.push(word);
    }
  }
  flush();

  return pages;
}

// Legacy cached pages (written before per-word support) lack `words`. Synthesize
// a single page-spanning word from the page text so the renderer's word path
// still works until the entry is regenerated.
function normalizePages(
  pages: SynthesizedCaptionPage[],
  fps: number
): SynthesizedCaptionPage[] {
  return pages.map((p) => {
    if (p.words && p.words.length > 0) return p;
    return {
      ...p,
      words: [
        {
          text: p.text,
          startMs: framesToMs(p.fromFrame, fps),
          endMs: framesToMs(p.toFrame, fps),
        },
      ],
    };
  });
}

async function findCached(
  db: Database,
  organizationId: string,
  hash: string
): Promise<SynthesizedCaptionPage[] | null> {
  const row = await db.query.audioAsset.findFirst({
    where: and(
      eq(audioAsset.organizationId, organizationId),
      eq(audioAsset.kind, 'captions'),
      eq(audioAsset.hash, hash)
    ),
    columns: { payload: true },
  });
  if (!row?.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as {
      pages?: SynthesizedCaptionPage[];
    };
    return parsed.pages ?? null;
  } catch {
    return null;
  }
}

// Download audio either by S3 key/URL or by a direct https URL.
async function fetchAudioBuffer(audioUrl: string): Promise<Buffer> {
  const s3Info = parseS3Url(audioUrl);
  if (s3Info) {
    return downloadAsBuffer({ bucket: s3Info.bucket, key: s3Info.key });
  }
  if (
    !audioUrl.startsWith('http://') &&
    !audioUrl.startsWith('https://') &&
    !audioUrl.startsWith('tts-stub://')
  ) {
    // Treat as bare S3 key in the org assets bucket.
    return downloadAsBuffer({ bucket: getOrgAssetsBucket(), key: audioUrl });
  }
  if (audioUrl.startsWith('tts-stub://')) {
    throw new Error('Cannot transcribe a stubbed TTS URL');
  }
  const res = await fetchWithRetry(audioUrl);
  if (!res.ok) {
    throw new Error(`Failed to download audio (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Calls OpenAI Whisper. Falls back to a deterministic stub when the API key
// is absent — same policy as synthesize-tts.
//
// TODO(provider): unify with packages/video-processing/whisper once the
// features → video-processing dependency is acceptable; today features doesn't
// depend on video-processing, so we call the OpenAI SDK directly.
async function transcribeAudio(
  audioUrl: string
): Promise<ProviderResult | { stub: true; durationSec: number }> {
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) {
    return { stub: true, durationSec: 5 };
  }

  const buffer = await fetchAudioBuffer(audioUrl);
  // Whisper API hard limit. We mirror the transcribe-video service.
  const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
  if (buffer.byteLength > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio file too large for Whisper API (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB, max 25MB)`
    );
  }

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const file = new File([buffer], 'audio.wav', { type: 'audio/wav' });

  const response = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  const r = response as unknown as {
    text?: string;
    duration?: number;
    words?: WhisperWord[];
  };

  const words = r.words ?? [];
  if (words.length === 0) {
    // Fall back to one word spanning the full audio.
    return {
      words: [{ word: r.text ?? '', start: 0, end: r.duration ?? 0 }],
      durationSec: r.duration ?? 0,
    };
  }
  return { words, durationSec: r.duration ?? words.at(-1)?.end ?? 0 };
}

const synthesizeCaptionsImpl = async (
  db: Database,
  input: SynthesizeCaptionsInput
): Promise<Result<SynthesizeCaptionsOutput>> => {
  const parsed = synthesizeCaptionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid synthesize-captions input',
        { issues: parsed.error.issues }
      )
    );
  }

  const {
    organizationId,
    audioUrl,
    fps,
    maxWordsPerPage,
    maxPageDurationMs,
    minGapFrames,
    editedText,
  } = parsed.data;
  const hash = hashKey(audioUrl, editedText);

  const cachedPages = await findCached(db, organizationId, hash);
  if (cachedPages) {
    return ok({ pages: normalizePages(cachedPages, fps), hash, cached: true });
  }

  try {
    const result = await transcribeAudio(audioUrl);
    let pages: SynthesizedCaptionPage[];
    if ('stub' in result) {
      const endMs = Math.max(1, Math.round(result.durationSec * 1000));
      const text = editedText?.trim()
        ? editedText.trim()
        : '[captions unavailable — provider key not configured]';
      pages = [
        {
          fromFrame: 0,
          toFrame: Math.max(1, Math.round(result.durationSec * fps)),
          text,
          words: [{ text, startMs: 0, endMs }],
        },
      ];
    } else {
      let words = whisperWordsToMs(result.words);
      if (editedText?.trim()) {
        words = alignEditedWords(words, editedText);
      }
      pages = packWords(
        words,
        fps,
        maxWordsPerPage,
        maxPageDurationMs,
        minGapFrames
      );
    }

    await db.insert(audioAsset).values({
      id: randomUUID(),
      kind: 'captions',
      hash,
      url: null,
      durationMs: Math.round(result.durationSec * 1000),
      payload: JSON.stringify({ pages, audioUrl }),
      organizationId,
    });

    return ok({ pages, hash, cached: false });
  } catch (error) {
    logError('videos.synthesizeCaptions', error, {
      feature: 'videos',
      extra: { organizationId, audioUrl, hash },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to synthesize captions'
      )
    );
  }
};

export const synthesizeCaptions = (
  db: Database,
  input: SynthesizeCaptionsInput
) =>
  trackedResult(
    'videos.synthesizeCaptions',
    () => synthesizeCaptionsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type SynthesizeCaptionsResult = Awaited<
  ReturnType<typeof synthesizeCaptions>
>;
