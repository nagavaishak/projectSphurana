import { fetchWithRetry } from '@borradh-workspace/http';
import type { ElevenLabsTTSConfig, TTSResult } from './types.js';

// Talk to the ElevenLabs REST API directly rather than through
// @elevenlabs/elevenlabs-js. The SDK is 52.7MB — the single largest package in
// the video-worker image — and we used exactly one call from it
// (textToSpeech.convert). `fetchWithRetry` gives us the retry + timeout
// behaviour the SDK was providing.
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

let _config: ElevenLabsTTSConfig | null = null;

// ElevenLabs has a limit of approximately 5000 characters per request
const MAX_CHUNK_LENGTH = 4500;

// Default output format - PCM 24kHz for WAV conversion
const OUTPUT_FORMAT = 'pcm_24000';
const SAMPLE_RATE = 24000;

/**
 * Initialize the ElevenLabs TTS service.
 *
 * @param config - ElevenLabs TTS configuration
 */
export function initElevenLabsTTS(config: ElevenLabsTTSConfig): void {
  _config = config;
}

/**
 * Check if ElevenLabs TTS is initialized.
 */
export function isElevenLabsTTSInitialized(): boolean {
  return _config !== null && Boolean(_config.apiKey);
}

/**
 * Get the current ElevenLabs TTS configuration.
 */
export function getElevenLabsTTSConfig(): ElevenLabsTTSConfig | null {
  return _config;
}

/**
 * Split text into chunks that fit within ElevenLabs' character limit.
 * Splits on sentence boundaries when possible.
 *
 * @param text - Text to split
 * @returns Array of text chunks
 */
function splitTextIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split on sentence boundary
    let splitIndex = -1;
    const searchEnd = MAX_CHUNK_LENGTH;

    // Look for sentence endings (. ! ?)
    for (let i = searchEnd; i >= searchEnd / 2; i--) {
      const char = remaining[i];
      if (char === '.' || char === '!' || char === '?') {
        // Check if it's followed by a space or is at the end
        if (i + 1 >= remaining.length || remaining[i + 1] === ' ') {
          splitIndex = i + 1;
          break;
        }
      }
    }

    // If no sentence boundary found, try to split on word boundary
    if (splitIndex === -1) {
      for (let i = searchEnd; i >= searchEnd / 2; i--) {
        if (remaining[i] === ' ') {
          splitIndex = i + 1;
          break;
        }
      }
    }

    // If still no good split point, force split at max length
    if (splitIndex === -1) {
      splitIndex = MAX_CHUNK_LENGTH;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Create a WAV header for PCM audio data.
 *
 * @param dataLength - Length of the PCM audio data in bytes
 * @param sampleRate - Sample rate (e.g., 24000)
 * @param numChannels - Number of channels (1 for mono)
 * @param bitsPerSample - Bits per sample (16)
 * @returns Buffer containing the WAV header
 */
function createWavHeader(
  dataLength: number,
  sampleRate: number = SAMPLE_RATE,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4); // File size - 8
  header.write('WAVE', 8);

  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Convert PCM audio data to WAV format.
 *
 * @param pcmData - Raw PCM audio data
 * @returns ArrayBuffer containing WAV audio
 */
function pcmToWav(pcmData: Buffer): ArrayBuffer {
  const header = createWavHeader(pcmData.length);
  const wav = Buffer.concat([header, pcmData]);
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
}

/**
 * Generate speech using ElevenLabs TTS API.
 * Returns WAV audio buffer.
 *
 * @param text - Text to convert to speech
 * @param voiceId - ElevenLabs voice ID
 * @returns TTS result with audio buffer and duration
 */
export async function generateElevenLabsSpeech(
  text: string,
  voiceId: string
): Promise<TTSResult> {
  if (!_config) {
    throw new Error(
      'ElevenLabs TTS not initialized. Call initElevenLabsTTS first.'
    );
  }
  const apiKey = _config.apiKey;

  const modelId = _config.modelId || 'eleven_multilingual_v2';
  const stability = _config.stability ?? 0.5;
  const similarityBoost = _config.similarityBoost ?? 0.75;
  // Style controls expressiveness - higher values = more dramatic/expressive delivery
  const style = _config.style ?? 0.45;
  // Speaker boost enhances voice clarity and similarity
  const useSpeakerBoost = _config.useSpeakerBoost ?? true;

  // Split text into chunks if necessary
  const chunks = splitTextIntoChunks(text);

  // Generate audio for each chunk
  const audioBuffers: Buffer[] = [];
  let totalDuration = 0;

  for (const chunk of chunks) {
    // The REST field names are snake_case; the SDK camelCased them for us.
    const response = await fetchWithRetry(
      `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/*',
        },
        body: JSON.stringify({
          text: chunk,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: useSpeakerBoost,
          },
        }),
        timeoutMs: 120_000,
      }
    );

    if (!response.ok) {
      // Body is JSON on error, audio on success — read it for a usable message.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `ElevenLabs TTS failed (${response.status} ${response.statusText})${
          detail ? `: ${detail.slice(0, 500)}` : ''
        }`
      );
    }

    const pcmData = Buffer.from(await response.arrayBuffer());
    audioBuffers.push(pcmData);

    // Calculate duration from PCM data
    // PCM 24kHz, 16-bit mono: 2 bytes per sample
    const bytesPerSample = 2;
    const duration = pcmData.length / (SAMPLE_RATE * bytesPerSample);
    totalDuration += duration;
  }

  // Merge PCM buffers if we have multiple chunks
  const mergedPcm =
    audioBuffers.length === 1 ? audioBuffers[0] : Buffer.concat(audioBuffers);

  // Convert PCM to WAV
  const wavAudio = pcmToWav(mergedPcm);

  return {
    audio: wavAudio,
    audioLength: totalDuration,
  };
}
