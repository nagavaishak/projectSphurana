import { describe, expect, it } from 'vitest';
import { generateTts, initTts, isTtsReady } from './tts-engine.js';

/**
 * Real ElevenLabs integration test — hits the live API, no mocking.
 *
 * Gated on ELEVENLABS_API_KEY so the normal test run (CI, local without the
 * key) skips it. Run it for real with the key from Pulumi:
 *
 *   ELEVENLABS_API_KEY="$(cd infra && pulumi config get elevenLabsApiKey --stack prod)" \
 *     pnpm --filter @borradh-workspace/video-processing exec vitest run src/tts/elevenlabs-tts.integration.test.ts
 *
 * Each run synthesizes ~40 characters on eleven_flash_v2_5 (~$0.05/1k chars),
 * so a full run costs a fraction of a cent.
 */
const apiKey = process.env.ELEVENLABS_API_KEY;

const TTS_TIMEOUT = 60_000;

function wavBytes(audio: ArrayBuffer): Buffer {
  return Buffer.from(audio);
}

describe('tts-engine (uninitialized)', () => {
  it('reports not ready and refuses to generate before init', async () => {
    expect(isTtsReady()).toBe(false);
    await expect(generateTts('hello', 'af_heart')).rejects.toThrow(
      /not initialized/i
    );
  });
});

describe.runIf(apiKey)('ElevenLabs TTS (real API)', () => {
  it('initializes with the API key', () => {
    initTts({ elevenLabsApiKey: apiKey });
    expect(isTtsReady()).toBe(true);
  });

  it(
    'synthesizes speech for a mapped Kokoro voice id',
    async () => {
      const result = await generateTts('Borradh voiceover check.', 'af_heart');

      // Non-trivial audio came back
      expect(result.audio.byteLength).toBeGreaterThan(1000);

      // Valid WAV container: RIFF header + WAVE format
      const bytes = wavBytes(result.audio);
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');

      // Spoken duration is plausible for a 4-word phrase
      expect(result.audioLength).toBeGreaterThan(0.5);
      expect(result.audioLength).toBeLessThan(10);

      // Duration matches the PCM payload (24kHz, 16-bit mono, 44-byte header)
      const pcmBytes = result.audio.byteLength - 44;
      expect(result.audioLength).toBeCloseTo(pcmBytes / (24_000 * 2), 1);
    },
    TTS_TIMEOUT
  );

  it(
    'falls back to the default voice for unrecognised stored voice ids',
    async () => {
      // Legacy OpenAI-era ids like "alloy" may still be stored on templates —
      // they must render via the default voice, not fail the job.
      const result = await generateTts('Fallback check.', 'alloy');
      expect(result.audio.byteLength).toBeGreaterThan(1000);
      expect(result.audioLength).toBeGreaterThan(0.2);
    },
    TTS_TIMEOUT
  );
});
