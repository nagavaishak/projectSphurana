import {
  constants,
  chmodSync,
  existsSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { accessSync } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import ffmpegLib from 'fluent-ffmpeg';
import * as fs from 'fs-extra';
import type {
  FFmpegInitOptions,
  FrameWithTimestamp,
  Orientation,
  RemuxErrorCode,
  VideoMetadata,
} from './types.js';

// Probed in priority order. /usr/bin is Linux/Docker (apt); /opt/homebrew is
// macOS arm64 Homebrew; /usr/local/bin is macOS x86 Homebrew. The npm
// installer fallback covers cases where none of these are present.
const SYSTEM_FFMPEG_CANDIDATES = [
  '/usr/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
];
const SYSTEM_FFPROBE_CANDIDATES = [
  '/usr/bin/ffprobe',
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
];

function findExecutable(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

// fluent-ffmpeg exports both a constructor and static methods
// We need to use it both as a function and access static methods
const ffmpeg = ffmpegLib as typeof ffmpegLib & {
  setFfmpegPath: (path: string) => void;
  setFfprobePath: (path: string) => void;
  ffprobe: typeof ffmpegLib.ffprobe;
};

let initialized = false;

const MP4_VIDEO_COPY_CODECS = new Set([
  'h264',
  'hevc',
  'av1',
  'mpeg4',
  'mjpeg',
]);

const MP4_AUDIO_COPY_CODECS = new Set([
  'aac',
  'mp3',
  'ac3',
  'eac3',
  'alac',
  'opus',
  'flac',
]);

const REMUX_OUTPUT_OVERHEAD_BYTES = 50 * 1024 * 1024; // 50MB safety margin

export class RemuxError extends Error {
  constructor(
    public readonly code: RemuxErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RemuxError';
  }
}

/**
 * Initialize FFmpeg with the correct paths.
 * This should be called once at application startup.
 */
export async function initFFmpeg(options?: FFmpegInitOptions): Promise<void> {
  if (initialized) return;

  if (options?.ffmpegPath && options?.ffprobePath) {
    ffmpeg.setFfmpegPath(options.ffmpegPath);
    ffmpeg.setFfprobePath(options.ffprobePath);
  } else {
    // Prefer system-installed binaries (apt in Docker, Homebrew on macOS).
    // The npm installer binaries may lack execute permissions when
    // pnpm install runs with --ignore-scripts in production builds.
    const systemFfmpeg = findExecutable(SYSTEM_FFMPEG_CANDIDATES);
    const systemFfprobe = findExecutable(SYSTEM_FFPROBE_CANDIDATES);

    if (systemFfmpeg && systemFfprobe) {
      ffmpeg.setFfmpegPath(systemFfmpeg);
      ffmpeg.setFfprobePath(systemFfprobe);
    } else {
      // Fall back to npm installer packages for local development.
      // pnpm sometimes drops the +x bit on the bundled binaries — restore it
      // before fluent-ffmpeg tries to spawn them.
      const installers = await loadInstallerBinaries();
      ensureExecutable(installers.ffmpeg);
      ensureExecutable(installers.ffprobe);
      ffmpeg.setFfmpegPath(installers.ffmpeg);
      ffmpeg.setFfprobePath(installers.ffprobe);
    }
  }

  initialized = true;
}

/**
 * Resolve ffmpeg/ffprobe paths from the `@ffmpeg-installer` / `@ffprobe-installer`
 * packages.
 *
 * These are devDependencies — a convenience for dev machines with no system
 * ffmpeg. Every deployed image apt-installs ffmpeg, so this branch is dead
 * there and the ~52MB of bundled per-platform binaries stay out of the
 * production bundle.
 *
 * The import is guarded because "no system ffmpeg AND no dev fallback" is a
 * legitimate state (any Linux container without the apt package). A bare
 * ERR_MODULE_NOT_FOUND names a package the reader has no reason to expect;
 * this says what is actually wrong and how to fix it.
 */
async function loadInstallerBinaries(): Promise<{
  ffmpeg: string;
  ffprobe: string;
}> {
  try {
    const [ffmpegInstaller, ffprobeInstaller] = await Promise.all([
      import('@ffmpeg-installer/ffmpeg'),
      import('@ffprobe-installer/ffprobe'),
    ]);
    return { ffmpeg: ffmpegInstaller.path, ffprobe: ffprobeInstaller.path };
  } catch (error) {
    throw new Error(
      `No ffmpeg/ffprobe available: none of ${SYSTEM_FFMPEG_CANDIDATES.join(', ')} exist, and the dev-only @ffmpeg-installer/@ffprobe-installer fallback is not installed. Install ffmpeg (apt-get install ffmpeg / brew install ffmpeg).`,
      { cause: error }
    );
  }
}

function ensureExecutable(binaryPath: string): void {
  if (!existsSync(binaryPath)) return;
  try {
    accessSync(binaryPath, constants.X_OK);
  } catch {
    // 0o755 — owner rwx, group/other rx. Matches the permission the npm
    // installer's postinstall script sets when it can run.
    chmodSync(binaryPath, 0o755);
  }
}

/**
 * Normalize audio for Whisper transcription (16kHz, mono, WAV format)
 */
export async function saveNormalizedAudio(
  audio: ArrayBuffer,
  outputPath: string
): Promise<string> {
  const inputStream = new Readable();
  inputStream.push(Buffer.from(audio));
  inputStream.push(null);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputStream)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .on('end', () => resolve(outputPath))
      .on('error', (error: unknown) => reject(error))
      .save(outputPath);
  });
}

/**
 * Convert audio buffer to MP3 data URI
 */
export async function createMp3DataUri(audio: ArrayBuffer): Promise<string> {
  const inputStream = new Readable();
  inputStream.push(Buffer.from(audio));
  inputStream.push(null);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    ffmpeg()
      .input(inputStream)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .audioChannels(2)
      .toFormat('mp3')
      .on('error', (err) => reject(err))
      .pipe()
      .on('data', (data: Buffer) => chunks.push(data))
      .on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(`data:audio/mp3;base64,${buffer.toString('base64')}`);
      })
      .on('error', (err) => reject(err));
  });
}

/**
 * Save audio buffer as MP3 file
 */
export async function saveToMp3(
  audio: ArrayBuffer,
  filePath: string
): Promise<string> {
  const inputStream = new Readable();
  inputStream.push(Buffer.from(audio));
  inputStream.push(null);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputStream)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .audioChannels(2)
      .toFormat('mp3')
      .save(filePath)
      .on('end', () => resolve(filePath))
      .on('error', (err) => reject(err));
  });
}

/**
 * Extract video metadata (duration, dimensions, frame rate, orientation)
 */
export async function getVideoMetadata(
  filePath: string
): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const videoStream = metadata.streams?.find(
        (stream) => stream.codec_type === 'video'
      );

      if (!videoStream || !metadata.format) {
        reject(new Error(`Unable to read video metadata for ${filePath}`));
        return;
      }

      const duration = metadata.format.duration
        ? Number(metadata.format.duration)
        : 0;
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      const frameRate = parseFrameRate(
        videoStream.avg_frame_rate as string | undefined
      );
      const orientation: Orientation =
        width >= height ? 'landscape' : 'portrait';

      resolve({ duration, width, height, frameRate, orientation });
    });
  });
}

/**
 * Extract video segment with specific timestamps
 * @param stripAudio - If true, removes audio track from the output (useful when using external audio)
 */
export async function extractVideoSegment(
  inputPath: string,
  startSeconds: number,
  durationSeconds: number,
  outputPath: string,
  stripAudio = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    const outputOptions = stripAudio
      ? [
          '-map',
          '0:v:0', // First video stream only
          '-c:v',
          'copy', // Copy video codec
          '-an', // No audio
          '-movflags',
          'faststart',
        ]
      : [
          '-map',
          '0:v:0', // First video stream
          '-map',
          '0:a:0', // First audio stream (usually AAC)
          '-c:v',
          'copy', // Copy video codec
          '-c:a',
          'aac', // Re-encode audio to AAC (safer than copy)
          '-b:a',
          '192k', // Audio bitrate
          '-movflags',
          'faststart',
        ];

    ffmpeg(inputPath)
      .setStartTime(Math.max(0, startSeconds))
      .setDuration(durationSeconds)
      .outputOptions(outputOptions)
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const errorMessage = `FFmpeg error: ${error.message}\nStderr: ${stderr || stderrOutput}`;
        reject(new Error(errorMessage));
      })
      .save(outputPath);
  });
}

/**
 * Extract audio segment from video
 */
export async function extractAudioSegment(
  inputPath: string,
  startSeconds: number,
  durationSeconds: number,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    if (durationSeconds <= 0) {
      reject(new Error(`Invalid duration: ${durationSeconds} seconds`));
      return;
    }

    const safeStartTime = Math.max(0, startSeconds);

    ffmpeg(inputPath)
      .setStartTime(safeStartTime)
      .setDuration(durationSeconds)
      .outputOptions([
        '-map',
        '0:a:0', // First audio stream only
        '-avoid_negative_ts',
        'make_zero',
      ])
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .noVideo()
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => {
        if (!fs.existsSync(outputPath)) {
          reject(new Error(`Output file was not created: ${outputPath}`));
          return;
        }

        const stats = statSync(outputPath);
        if (stats.size === 0) {
          reject(new Error(`Output file is empty: ${outputPath}`));
          return;
        }

        resolve(outputPath);
      })
      .on('error', (error, _stdout, stderr) => {
        const errorMessage = `FFmpeg error: ${error.message}\nInput: ${inputPath}, Start: ${safeStartTime}s, Duration: ${durationSeconds}s\nStderr: ${stderr || stderrOutput}`;
        reject(new Error(errorMessage));
      })
      .save(outputPath);
  });
}

/**
 * Extract full audio from video file
 */
export async function extractAudio(
  inputPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    ffmpeg(inputPath)
      .outputOptions(['-map', '0:a:0'])
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .noVideo()
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const errorMessage = `FFmpeg error: ${error.message}\nStderr: ${stderr || stderrOutput}`;
        reject(new Error(errorMessage));
      })
      .save(outputPath);
  });
}

/**
 * Get audio file duration in seconds
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const audioStream = metadata.streams?.find(
        (stream) => stream.codec_type === 'audio'
      );

      if (!audioStream && metadata.format?.duration) {
        resolve(Number(metadata.format.duration));
        return;
      }

      if (!audioStream) {
        reject(new Error(`Unable to find audio stream in ${filePath}`));
        return;
      }

      const duration = audioStream.duration
        ? Number(audioStream.duration)
        : metadata.format?.duration
          ? Number(metadata.format.duration)
          : 0;

      if (duration === 0) {
        reject(new Error(`Audio duration is 0 for ${filePath}`));
        return;
      }

      resolve(duration);
    });
  });
}

/**
 * Convert audio file to different format
 */
export async function convertAudio(
  inputPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .audioChannels(2)
      .toFormat('mp3')
      .on('end', () => resolve(outputPath))
      .on('error', (error) => reject(error))
      .save(outputPath);
  });
}

/**
 * Convert audio file to WAV format (16kHz, mono) for Whisper
 */
export async function convertAudioToWav(
  inputPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .on('end', () => resolve(outputPath))
      .on('error', (error) => reject(error))
      .save(outputPath);
  });
}

/**
 * Extract audio from video and save as WAV format (16kHz, mono) for Whisper
 * Combines extractAudio + convertAudioToWav in a single ffmpeg pass
 */
export async function extractAudioAsWav(
  inputPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    ffmpeg(inputPath)
      .outputOptions(['-map', '0:a:0'])
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .noVideo()
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const errorMessage = `FFmpeg error: ${error.message}\nStderr: ${stderr || stderrOutput}`;
        reject(new Error(errorMessage));
      })
      .save(outputPath);
  });
}

/**
 * Parse frame rate string (e.g., "30/1" or "29.97")
 */
/**
 * Extract key frames from a video at evenly-spaced intervals
 * Used for AI vision analysis of video content
 *
 * @param videoPath - Path to the video file
 * @param options - Options for frame extraction
 * @returns Array of paths to extracted frame images (JPEG)
 */
export async function extractKeyFrames(
  videoPath: string,
  options: {
    count?: number;
    outputDir: string;
    quality?: number; // 1-31, lower is better quality
  }
): Promise<string[]> {
  const { count = 5, outputDir, quality = 5 } = options;

  // Get video duration first
  const metadata = await getVideoMetadata(videoPath);
  const { duration } = metadata;

  if (duration <= 0) {
    throw new Error(`Invalid video duration: ${duration}`);
  }

  // Calculate timestamps for evenly-spaced frames
  const timestamps: number[] = [];
  if (count === 1) {
    timestamps.push(duration / 2); // Single frame at middle
  } else {
    for (let i = 0; i < count; i++) {
      // Spread frames evenly across the video duration
      const timestamp = (duration / (count + 1)) * (i + 1);
      timestamps.push(timestamp);
    }
  }

  const framePaths: string[] = [];

  // Extract each frame
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = `${outputDir}/frame_${i.toString().padStart(2, '0')}.jpg`;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .outputOptions([
          '-vframes',
          '1',
          '-q:v',
          String(quality),
          '-vf',
          'scale=1280:-1', // Scale width to 1280, maintain aspect ratio
        ])
        .on('end', () => {
          framePaths.push(outputPath);
          resolve();
        })
        .on('error', (error) =>
          reject(
            new Error(
              `Failed to extract frame at ${timestamp}s: ${error.message}`
            )
          )
        )
        .save(outputPath);
    });
  }

  return framePaths;
}

/**
 * Extract key frames from a video at evenly-spaced intervals, returning
 * both the file path and the timestamp each frame was extracted from.
 * Used for AI vision analysis that needs to correlate frames with time.
 *
 * @param videoPath - Path to the video file
 * @param options - Options for frame extraction
 * @returns Array of { path, timestampSec } for each extracted frame
 */
export async function extractKeyFramesWithTimestamps(
  videoPath: string,
  options: {
    count?: number;
    outputDir: string;
    quality?: number;
  }
): Promise<FrameWithTimestamp[]> {
  const { count = 10, outputDir, quality = 5 } = options;

  const metadata = await getVideoMetadata(videoPath);
  const { duration } = metadata;

  if (duration <= 0) {
    throw new Error(`Invalid video duration: ${duration}`);
  }

  const timestamps: number[] = [];
  if (count === 1) {
    timestamps.push(duration / 2);
  } else {
    for (let i = 0; i < count; i++) {
      const timestamp = (duration / (count + 1)) * (i + 1);
      timestamps.push(timestamp);
    }
  }

  const frames: FrameWithTimestamp[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = `${outputDir}/frame_${i.toString().padStart(2, '0')}.jpg`;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .outputOptions([
          '-vframes',
          '1',
          '-q:v',
          String(quality),
          '-vf',
          'scale=1280:-1',
        ])
        .on('end', () => {
          frames.push({ path: outputPath, timestampSec: timestamp });
          resolve();
        })
        .on('error', (error) =>
          reject(
            new Error(
              `Failed to extract frame at ${timestamp}s: ${error.message}`
            )
          )
        )
        .save(outputPath);
    });
  }

  return frames;
}

/**
 * Remux an MP4 file to move the moov atom to the beginning for progressive playback.
 * This enables browsers to start playing before downloading the entire file.
 * Performs a fast copy (no re-encoding).
 */
export async function addFastStart(
  inputPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    ffmpeg(inputPath)
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const errorMessage = `FFmpeg faststart error: ${error.message}\nStderr: ${stderr || stderrOutput}`;
        reject(new Error(errorMessage));
      })
      .save(outputPath);
  });
}

/**
 * Remux a video file (e.g., .mov) to MP4 with faststart moov atom.
 * Copies all streams without re-encoding — fast operation.
 * This ensures the moov atom is at the start of the file so that
 * HTTP range requests (used by Remotion Lambda's proxy) work efficiently
 * without needing to download the entire file.
 *
 * @returns true if remux was performed, false if already an MP4
 */
export async function remuxToFaststartMp4(
  inputPath: string,
  outputPath: string
): Promise<string> {
  let compatibility: RemuxCompatibility;
  try {
    compatibility = await getRemuxCompatibility(inputPath);
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const code = classifyRemuxError(baseMessage, '');
    throw new RemuxError(
      code,
      `FFprobe remux precheck failed: ${baseMessage}`,
      {
        inputPath,
        outputPath,
      }
    );
  }

  // Only the FIRST video and FIRST audio stream are mapped into the output —
  // secondary streams (cover-art video, alternate audio tracks, data/subtitle
  // streams) are dropped rather than failing the remux.
  const firstVideo = compatibility.videoStreams[0];
  const firstAudio = compatibility.audioStreams[0];

  // Un-copyable FIRST video codec is the genuine transcode case — surface it
  // as UNSUPPORTED_CODEC so callers fall back to transcodeToFaststartMp4.
  if (
    firstVideo &&
    (isUnknownCodec(firstVideo.codec) ||
      !MP4_VIDEO_COPY_CODECS.has(firstVideo.codec as string))
  ) {
    throw new RemuxError(
      'UNSUPPORTED_CODEC',
      'Input video codec cannot be stream-copied to MP4',
      {
        inputPath,
        outputPath,
        inputCodecs: compatibility,
        unsupportedVideoCodecs: [firstVideo.codec ?? 'none'],
      }
    );
  }

  // Unidentifiable first audio codec ('none') → drop audio instead of
  // failing: ffmpeg has no decoder for it, but the video is fine.
  const includeAudio =
    firstAudio !== undefined && !isUnknownCodec(firstAudio.codec);

  // A known-but-uncopyable first audio codec (e.g. pcm_s24le) still routes to
  // the transcode fallback so the audio is preserved via AAC re-encode
  // instead of being silently dropped.
  if (includeAudio && !MP4_AUDIO_COPY_CODECS.has(firstAudio.codec as string)) {
    throw new RemuxError(
      'UNSUPPORTED_CODEC',
      'Input audio codec cannot be stream-copied to MP4',
      {
        inputPath,
        outputPath,
        inputCodecs: compatibility,
        unsupportedAudioCodecs: [firstAudio.codec],
      }
    );
  }

  assertEnoughDiskSpace(inputPath, outputPath);

  return new Promise((resolve, reject) => {
    let stderrOutput = '';
    let command = '';

    ffmpeg(inputPath)
      .outputOptions([
        '-map',
        '0:v:0',
        ...(includeAudio ? ['-map', '0:a:0?'] : ['-an']),
        '-dn',
        '-sn',
        '-c:v',
        'copy',
        ...(includeAudio ? ['-c:a', 'copy'] : []),
        '-movflags',
        '+faststart',
      ])
      .toFormat('mp4')
      .on('start', (commandLine) => {
        command = commandLine;
      })
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const stderrText = stderr || stderrOutput;
        const code = classifyRemuxError(error.message, stderrText);
        reject(
          new RemuxError(code, `FFmpeg remux error: ${error.message}`, {
            inputPath,
            outputPath,
            command,
            inputCodecs: compatibility,
            stderr: stderrText,
          })
        );
      })
      .save(outputPath);
  });
}

/**
 * Re-encode any input to a faststart H.264 / AAC MP4.
 *
 * The fallback for `remuxToFaststartMp4` when the source has codecs that can't
 * be stream-copied into an MP4 container (ENG-338 — e.g. ProRes / VP9 source).
 * Unlike remux this re-encodes, so it always produces a streamable MP4 instead
 * of failing the pipeline. Slower than a copy, but only hit on the rare
 * non-copyable codec path.
 */
export async function transcodeToFaststartMp4(
  inputPath: string,
  outputPath: string
): Promise<string> {
  assertEnoughDiskSpace(inputPath, outputPath);

  // Probe audio codecs before transcoding. Only the FIRST audio stream is
  // mapped (below), so only its codec matters: if it reports codec 'none'
  // (unidentifiable — e.g. a proprietary or corrupted audio track), ffmpeg
  // cannot find a decoder and exits with code 1. Drop audio entirely in that
  // case rather than failing the whole transcode.
  let includeAudio = true;
  try {
    const { audioStreams } = await getRemuxCompatibility(inputPath);
    const firstAudio = audioStreams[0];
    if (firstAudio && isUnknownCodec(firstAudio.codec)) {
      includeAudio = false;
    }
  } catch {
    // Probe failed — attempt with audio and let ffmpeg decide
  }

  const outputOptions = [
    '-map',
    '0:v:0',
    ...(includeAudio ? ['-map', '0:a:0?'] : []),
    '-dn',
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    ...(includeAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []),
    '-movflags',
    '+faststart',
  ];

  return new Promise((resolve, reject) => {
    let stderrOutput = '';

    ffmpeg(inputPath)
      .outputOptions(outputOptions)
      .toFormat('mp4')
      .on('stderr', (stderrLine) => {
        stderrOutput += `${stderrLine}\n`;
      })
      .on('end', () => resolve(outputPath))
      .on('error', (error, _stdout, stderr) => {
        const stderrText = stderr || stderrOutput;
        const code = classifyRemuxError(error.message, stderrText);
        reject(
          new RemuxError(
            code,
            `FFmpeg transcode-to-MP4 error: ${error.message}`,
            { inputPath, outputPath, stderr: stderrText }
          )
        );
      })
      .save(outputPath);
  });
}

/**
 * Parse frame rate string (e.g., "30/1" or "29.97")
 */
function parseFrameRate(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value.split('/');
  if (parts.length === 2) {
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (
      !Number.isNaN(numerator) &&
      !Number.isNaN(denominator) &&
      denominator !== 0
    ) {
      return numerator / denominator;
    }
  }

  const numeric = Number(value);
  return Number.isNaN(numeric) ? undefined : numeric;
}

interface RemuxStreamInfo {
  index: number;
  /** Lowercased codec name, or null when ffprobe couldn't identify it. */
  codec: string | null;
}

interface RemuxCompatibility {
  videoStreams: RemuxStreamInfo[];
  audioStreams: RemuxStreamInfo[];
}

/** True when a probed codec is unidentifiable (ffmpeg has no decoder for it). */
function isUnknownCodec(codec: string | null): boolean {
  return !codec || codec === 'none';
}

async function getRemuxCompatibility(
  inputPath: string
): Promise<RemuxCompatibility> {
  const metadata = await new Promise<ffmpegLib.FfprobeData>(
    (resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(data);
      });
    }
  );

  // IMPORTANT: keep streams with unidentifiable codecs (codec: null) instead
  // of silently dropping them. Dropping them meant the 'none'-codec guards
  // downstream could never fire, so ffmpeg later died with
  // "Decoder (codec none) not found" and the failure classified as UNKNOWN.
  const toStreamInfo = (stream: ffmpegLib.FfprobeStream): RemuxStreamInfo => ({
    index: stream.index,
    codec: stream.codec_name ? stream.codec_name.toLowerCase() : null,
  });

  return {
    videoStreams: metadata.streams
      .filter((stream) => stream.codec_type === 'video')
      .map(toStreamInfo),
    audioStreams: metadata.streams
      .filter((stream) => stream.codec_type === 'audio')
      .map(toStreamInfo),
  };
}

function assertEnoughDiskSpace(inputPath: string, outputPath: string): void {
  const inputSizeBytes = statSync(inputPath).size;
  const requiredBytes = inputSizeBytes + REMUX_OUTPUT_OVERHEAD_BYTES;
  const outputDirectory = path.dirname(outputPath);
  const stats = statfsSync(outputDirectory);
  const availableBytes = stats.bavail * stats.bsize;

  if (availableBytes < requiredBytes) {
    throw new RemuxError(
      'DISK_SPACE',
      'Not enough disk space available for remux output',
      {
        inputPath,
        outputPath,
        inputSizeBytes,
        requiredBytes,
        availableBytes,
      }
    );
  }
}

// Unknown errors fall back to the original file rather than failing the job;
// only errors we've explicitly classified as infra-level (DISK_SPACE,
// SYSTEM_ERROR) propagate. Add patterns here as new failure modes show up.
export function classifyRemuxError(
  message: string,
  stderr: string
): RemuxErrorCode {
  const haystack = `${message}\n${stderr}`.toLowerCase();

  if (
    haystack.includes('no space left on device') ||
    haystack.includes('disk full') ||
    haystack.includes('insufficient space')
  ) {
    return 'DISK_SPACE';
  }

  if (
    haystack.includes('invalid data found when processing input') ||
    haystack.includes('moov atom not found') ||
    haystack.includes('error reading header') ||
    (haystack.includes('invalid argument') &&
      haystack.includes('error while decoding'))
  ) {
    return 'CORRUPTED_INPUT';
  }

  if (
    haystack.includes('codec not currently supported in container') ||
    haystack.includes('could not find tag for codec') ||
    haystack.includes('could not write header for output file') ||
    // Stream with an unidentifiable codec that slipped past the probe guard —
    // route to the transcode fallback rather than UNKNOWN.
    haystack.includes('decoder (codec none) not found')
  ) {
    return 'UNSUPPORTED_CODEC';
  }

  return 'UNKNOWN';
}
