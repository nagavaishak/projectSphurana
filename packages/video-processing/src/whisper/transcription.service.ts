/**
 * Unified Transcription Service
 *
 * Factory service that chooses between local whisper.cpp and cloud OpenAI Whisper API
 * based on configuration. Provides a consistent interface for video processing.
 *
 * Usage:
 * ```typescript
 * // Initialize with config
 * await initTranscription({
 *   mode: 'cloud', // or 'local'
 *   cloud: { apiKey: process.env.OPENAI_API_KEY },
 *   local: { model: 'base.en', installPath: '/app/.whisper', version: '1.5.5' }
 * });
 *
 * // Create captions (uses configured mode)
 * const captions = await transcribe(audioPath);
 * ```
 */

import type {
  Caption,
  TranscriptionConfig,
  TranscriptionMode,
  WhisperConfig,
} from './types.js';
import {
  createCaptionsWithApi,
  initWhisperApi,
  isWhisperApiInitialized,
  transcribeAudioWithApi,
} from './whisper-api.service.js';

// Local whisper.cpp functions are loaded dynamically to avoid requiring
// @remotion/install-whisper-cpp at module load time. This package is an
// optionalDependency — it's installed in local dev but skipped in Docker
// where cloud mode (OpenAI Whisper API) is always used.
async function getLocalWhisper() {
  const mod = await import('./whisper.service.js');
  return mod;
}

let currentConfig: TranscriptionConfig | null = null;

/**
 * Initialize the transcription service with the given configuration.
 *
 * @param config - Transcription configuration specifying mode and credentials
 * @param skipLocalInstall - If true, skip local whisper installation (for Docker)
 */
export async function initTranscription(
  config: TranscriptionConfig,
  skipLocalInstall = false
): Promise<void> {
  currentConfig = config;

  if (config.mode === 'cloud') {
    if (!config.cloud?.apiKey) {
      throw new Error(
        'Cloud transcription requires OPENAI_API_KEY in cloud config'
      );
    }
    initWhisperApi(config.cloud);
    console.log(
      '[transcription] Initialized in CLOUD mode (OpenAI Whisper API)'
    );
  } else {
    if (!config.local) {
      throw new Error('Local transcription requires local whisper config');
    }
    const { initWhisper } = await getLocalWhisper();
    await initWhisper(config.local, skipLocalInstall);
    console.log('[transcription] Initialized in LOCAL mode (whisper.cpp)');
  }
}

/**
 * Get the current transcription mode
 */
export function getTranscriptionMode(): TranscriptionMode | null {
  return currentConfig?.mode || null;
}

/**
 * Check if transcription service is initialized
 */
export function isTranscriptionInitialized(): boolean {
  if (!currentConfig) return false;

  if (currentConfig.mode === 'cloud') {
    return isWhisperApiInitialized();
  }

  // For local, just check if config exists (whisper checks on transcribe)
  return currentConfig.local !== undefined;
}

/**
 * Create captions from audio file using the configured transcription mode.
 *
 * @param audioPath - Path to the audio file
 * @param overrideMode - Optional override for transcription mode
 */
export async function transcribe(
  audioPath: string,
  overrideMode?: TranscriptionMode
): Promise<Caption[]> {
  const mode = overrideMode || currentConfig?.mode;

  if (!mode) {
    throw new Error(
      'Transcription not initialized. Call initTranscription first.'
    );
  }

  const startTime = Date.now();
  let captions: Caption[];

  if (mode === 'cloud') {
    if (!currentConfig?.cloud) {
      throw new Error('Cloud config not set');
    }
    captions = await createCaptionsWithApi(audioPath, currentConfig.cloud);
  } else {
    if (!currentConfig?.local) {
      throw new Error('Local config not set');
    }
    const { createCaptions: createCaptionsLocal } = await getLocalWhisper();
    captions = await createCaptionsLocal(audioPath, currentConfig.local);
  }

  const duration = Date.now() - startTime;
  console.log(
    `[transcription] Mode: ${mode}, Duration: ${(duration / 1000).toFixed(2)}s, Words: ${captions.length}`
  );

  return captions;
}

/**
 * Get raw transcription text from audio file.
 *
 * @param audioPath - Path to the audio file
 * @param overrideMode - Optional override for transcription mode
 */
export async function transcribeToText(
  audioPath: string,
  overrideMode?: TranscriptionMode
): Promise<string> {
  const mode = overrideMode || currentConfig?.mode;

  if (!mode) {
    throw new Error(
      'Transcription not initialized. Call initTranscription first.'
    );
  }

  if (mode === 'cloud') {
    if (!currentConfig?.cloud) {
      throw new Error('Cloud config not set');
    }
    return transcribeAudioWithApi(audioPath, currentConfig.cloud);
  }
  if (!currentConfig?.local) {
    throw new Error('Local config not set');
  }
  const { transcribeAudio: transcribeAudioLocal } = await getLocalWhisper();
  return transcribeAudioLocal(audioPath, currentConfig.local);
}

/**
 * Create a transcription config from environment variables.
 * Automatically detects whether to use cloud or local mode.
 *
 * Environment variables:
 * - TRANSCRIPTION_MODE: 'cloud' | 'local' (default: auto-detect)
 * - OPENAI_API_KEY: Required for cloud mode
 * - WHISPER_MODEL: Model name for local mode (default: 'base.en')
 * - WHISPER_INSTALL_PATH: Path for whisper.cpp installation
 * - WHISPER_VERSION: whisper.cpp version (default: '1.5.5')
 */
export function createConfigFromEnv(): TranscriptionConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const explicitMode = process.env.TRANSCRIPTION_MODE as
    | TranscriptionMode
    | undefined;

  // Auto-detect mode: use cloud if OPENAI_API_KEY is set, otherwise local
  const mode: TranscriptionMode =
    explicitMode || (openaiApiKey ? 'cloud' : 'local');

  const config: TranscriptionConfig = {
    mode,
  };

  if (mode === 'cloud') {
    if (!openaiApiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for cloud transcription mode'
      );
    }
    config.cloud = {
      apiKey: openaiApiKey,
      model: 'whisper-1',
      verbose: process.env.LOG_LEVEL === 'debug',
    };
  }

  // Always include local config as fallback
  config.local = {
    model: (process.env.WHISPER_MODEL as WhisperConfig['model']) || 'base.en',
    installPath:
      process.env.WHISPER_INSTALL_PATH ||
      `${process.env.HOME || '/app'}/.whisper`,
    version: process.env.WHISPER_VERSION || '1.5.5',
    verbose: process.env.LOG_LEVEL === 'debug',
  };

  return config;
}
