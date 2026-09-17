import {
  generateElevenLabsSpeech,
  initElevenLabsTTS,
  isElevenLabsTTSInitialized,
} from './elevenlabs-tts.service.js';
import { ELEVENLABS_VOICES, VOICE_MAP } from './elevenlabs-voice-mapping.js';
import type { ElevenLabsModel, KokoroVoice, TTSResult } from './types.js';

/**
 * Default ElevenLabs model. Flash v2.5 is ~$0.05 / 1,000 chars — the cheapest
 * tier while keeping natural quality. Override via `initTts({ elevenLabsModelId })`.
 */
const DEFAULT_ELEVENLABS_MODEL: ElevenLabsModel = 'eleven_flash_v2_5';

export interface InitTtsOptions {
  /** ElevenLabs API key. Required for TTS to be available. */
  elevenLabsApiKey?: string;
  /** ElevenLabs model id. Defaults to `eleven_flash_v2_5`. */
  elevenLabsModelId?: ElevenLabsModel;
}

/**
 * Initialize the TTS engine (ElevenLabs). No-op when no API key is supplied,
 * leaving `isTtsReady()` false so callers can surface a clear error.
 */
export function initTts(options: InitTtsOptions): void {
  const { elevenLabsApiKey, elevenLabsModelId } = options;

  if (elevenLabsApiKey) {
    initElevenLabsTTS({
      apiKey: elevenLabsApiKey,
      modelId: elevenLabsModelId ?? DEFAULT_ELEVENLABS_MODEL,
    });
  }
}

/**
 * Whether the TTS engine is initialized and ready to generate audio.
 */
export function isTtsReady(): boolean {
  return isElevenLabsTTSInitialized();
}

/** Fallback ElevenLabs voice for ids we don't recognise (Rachel — calm narration). */
const DEFAULT_ELEVENLABS_VOICE = ELEVENLABS_VOICES.rachel;

/**
 * Resolve a stored voice id to an ElevenLabs voice id. Stored ids are normally
 * Kokoro voice identifiers (e.g. `af_heart`), but legacy/template values (e.g.
 * the OpenAI `alloy` default) may slip through — those map to a sane default
 * rather than failing the render.
 */
function resolveElevenLabsVoice(voice: string): string {
  return VOICE_MAP[voice as KokoroVoice] ?? DEFAULT_ELEVENLABS_VOICE;
}

/**
 * Generate speech for the given text using ElevenLabs.
 *
 * The stored voice id is mapped to the corresponding ElevenLabs voice (with a
 * default for unrecognised ids). Throws when the engine is not initialized.
 *
 * @param text - Text to synthesize
 * @param voice - Stored voice identifier (Kokoro id, the selection abstraction)
 */
export async function generateTts(
  text: string,
  voice: string
): Promise<TTSResult> {
  if (!isElevenLabsTTSInitialized()) {
    throw new Error(
      'TTS not initialized. Call initTts with an ElevenLabs API key first.'
    );
  }
  return generateElevenLabsSpeech(text, resolveElevenLabsVoice(voice));
}
