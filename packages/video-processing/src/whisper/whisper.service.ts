import * as path from 'node:path';
import type { Caption as RemotionCaption } from '@remotion/captions';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from '@remotion/install-whisper-cpp';
import type { Caption, WhisperConfig, WhisperModel } from './types.js';

let config: WhisperConfig | null = null;

/**
 * Initialize the Whisper service with the given configuration.
 * This will install WhisperCpp and download the model if not already present.
 *
 * @param whisperConfig - Configuration for Whisper
 * @param skipInstall - If true, skip installation (for Docker environments)
 */
export async function initWhisper(
  whisperConfig: WhisperConfig,
  skipInstall = false
): Promise<void> {
  config = whisperConfig;

  if (skipInstall) {
    return;
  }

  // Install WhisperCpp
  await installWhisperCpp({
    to: whisperConfig.installPath,
    version: whisperConfig.version,
    printOutput: whisperConfig.verbose ?? false,
  });

  // Download the model
  await downloadWhisperModel({
    model: whisperConfig.model,
    folder: path.join(whisperConfig.installPath, 'models'),
    printOutput: whisperConfig.verbose ?? false,
  });
}

/**
 * Get the current Whisper configuration
 */
export function getWhisperConfig(): WhisperConfig | null {
  return config;
}

/**
 * Create captions from audio file using Whisper transcription.
 * Uses @remotion/captions format for TikTok-style word highlighting.
 *
 * @param audioPath - Path to the audio file (WAV format, 16kHz recommended)
 * @param options - Optional overrides for model and paths
 */
export async function createCaptions(
  audioPath: string,
  options?: Partial<WhisperConfig>
): Promise<Caption[]> {
  const effectiveConfig = { ...config, ...options };

  if (
    !effectiveConfig.model ||
    !effectiveConfig.installPath ||
    !effectiveConfig.version
  ) {
    throw new Error('Whisper not initialized. Call initWhisper first.');
  }

  const whisperOutput = await transcribe({
    model: effectiveConfig.model as WhisperModel,
    whisperPath: effectiveConfig.installPath,
    modelFolder: path.join(effectiveConfig.installPath, 'models'),
    whisperCppVersion: effectiveConfig.version,
    inputPath: audioPath,
    tokenLevelTimestamps: true,
    printOutput: effectiveConfig.verbose ?? false,
    splitOnWord: true,
  });

  // Use toCaptions to convert Whisper output to @remotion/captions format
  const { captions } = toCaptions({ whisperCppOutput: whisperOutput });

  // Convert to our Caption format
  return captions.map((cap: RemotionCaption) => ({
    text: cap.text,
    startMs: cap.startMs,
    endMs: cap.endMs,
    timestampMs: (cap.startMs + cap.endMs) / 2,
    confidence: null,
  }));
}

/**
 * Transcribe audio and return raw transcription text (without caption processing).
 *
 * @param audioPath - Path to the audio file
 * @param options - Optional overrides for model and paths
 */
export async function transcribeAudio(
  audioPath: string,
  options?: Partial<WhisperConfig>
): Promise<string> {
  const effectiveConfig = { ...config, ...options };

  if (
    !effectiveConfig.model ||
    !effectiveConfig.installPath ||
    !effectiveConfig.version
  ) {
    throw new Error('Whisper not initialized. Call initWhisper first.');
  }

  const { transcription } = await transcribe({
    model: effectiveConfig.model as WhisperModel,
    whisperPath: effectiveConfig.installPath,
    modelFolder: path.join(effectiveConfig.installPath, 'models'),
    whisperCppVersion: effectiveConfig.version,
    inputPath: audioPath,
    tokenLevelTimestamps: false,
    printOutput: effectiveConfig.verbose ?? false,
  });

  return transcription.map((record) => record.text).join(' ');
}
