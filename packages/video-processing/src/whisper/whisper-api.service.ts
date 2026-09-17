/**
 * OpenAI Whisper API Service
 *
 * Cloud-based transcription using OpenAI's Whisper API.
 * Much faster than local whisper.cpp (5-10s vs 30-60s for a 30s video).
 *
 * Pricing: ~$0.006/minute of audio
 * - 30s video = $0.003
 * - 1000 videos/month = $3/month
 */

import * as fs from 'node:fs';
import OpenAI from 'openai';
import type { Caption, WhisperApiConfig, WhisperApiModel } from './types.js';

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25MB OpenAI Whisper limit

let config: WhisperApiConfig | null = null;
let client: OpenAI | null = null;

/**
 * Initialize the OpenAI Whisper API client
 */
export function initWhisperApi(apiConfig: WhisperApiConfig): void {
  config = apiConfig;
  client = new OpenAI({
    apiKey: apiConfig.apiKey,
  });
}

/**
 * Get the current Whisper API configuration
 */
export function getWhisperApiConfig(): WhisperApiConfig | null {
  return config;
}

/**
 * Check if the Whisper API is initialized
 */
export function isWhisperApiInitialized(): boolean {
  return client !== null && config !== null;
}

/**
 * Create captions from audio file using OpenAI Whisper API.
 * Returns word-level timestamps for TikTok-style caption highlighting.
 *
 * @param audioPath - Path to the audio file (WAV, MP3, etc.)
 * @param options - Optional overrides for model and language
 */
export async function createCaptionsWithApi(
  audioPath: string,
  options?: Partial<WhisperApiConfig>
): Promise<Caption[]> {
  if (!client || !config) {
    throw new Error('Whisper API not initialized. Call initWhisperApi first.');
  }

  const effectiveConfig = { ...config, ...options };
  const model: WhisperApiModel = effectiveConfig.model || 'whisper-1';

  if (effectiveConfig.verbose) {
    console.log(`[whisper-api] Transcribing: ${audioPath}`);
    console.log(`[whisper-api] Model: ${model}`);
  }

  const startTime = Date.now();

  // Guard: OpenAI Whisper API has a 25MB file size limit
  const stat = fs.statSync(audioPath);
  if (stat.size > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio file too large for Whisper API (${(stat.size / (1024 * 1024)).toFixed(1)}MB, max 25MB): ${audioPath}`
    );
  }

  // Read the audio file
  const audioFile = fs.createReadStream(audioPath);

  // Call OpenAI Whisper API with word-level timestamps
  const response = await client.audio.transcriptions.create({
    file: audioFile,
    model,
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
    language: effectiveConfig.language,
  });

  const duration = Date.now() - startTime;

  if (effectiveConfig.verbose) {
    console.log(`[whisper-api] Transcription completed in ${duration}ms`);
    console.log(`[whisper-api] Text: ${response.text?.substring(0, 100)}...`);
  }

  // Convert OpenAI response to our Caption format
  // The verbose_json format with word timestamps returns a 'words' array
  const words = (
    response as { words?: Array<{ word: string; start: number; end: number }> }
  ).words;

  if (!words || words.length === 0) {
    // Fallback: create a single caption for the entire transcription
    console.warn(
      '[whisper-api] No word-level timestamps available, creating single caption'
    );
    return [
      {
        text: response.text || '',
        startMs: 0,
        endMs: (response.duration || 0) * 1000,
        timestampMs: 0,
        confidence: null,
      },
    ];
  }

  // Map words to our Caption format
  return words.map((word) => ({
    text: word.word.trim(),
    startMs: Math.round(word.start * 1000),
    endMs: Math.round(word.end * 1000),
    timestampMs: Math.round(((word.start + word.end) / 2) * 1000),
    confidence: null,
  }));
}

/**
 * Transcribe audio and return raw transcription text.
 *
 * @param audioPath - Path to the audio file
 * @param options - Optional overrides for model and language
 */
export async function transcribeAudioWithApi(
  audioPath: string,
  options?: Partial<WhisperApiConfig>
): Promise<string> {
  if (!client || !config) {
    throw new Error('Whisper API not initialized. Call initWhisperApi first.');
  }

  const effectiveConfig = { ...config, ...options };
  const model: WhisperApiModel = effectiveConfig.model || 'whisper-1';

  // Guard: OpenAI Whisper API has a 25MB file size limit
  const stat = fs.statSync(audioPath);
  if (stat.size > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio file too large for Whisper API (${(stat.size / (1024 * 1024)).toFixed(1)}MB, max 25MB): ${audioPath}`
    );
  }

  const audioFile = fs.createReadStream(audioPath);

  const response = await client.audio.transcriptions.create({
    file: audioFile,
    model,
    response_format: 'text',
    language: effectiveConfig.language,
  });

  // When response_format is 'text', the response is a string
  return response as unknown as string;
}
