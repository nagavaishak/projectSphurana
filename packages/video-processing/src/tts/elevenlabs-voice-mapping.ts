import type { KokoroVoice } from './types.js';

/**
 * ElevenLabs voice IDs.
 * These are the official voice IDs from ElevenLabs.
 *
 * @see https://elevenlabs.io/docs/voices/premade-voices
 */
export const ELEVENLABS_VOICES = {
  // Female voices
  rachel: '21m00Tcm4TlvDq8ikWAM', // American female, calm, narration
  domi: 'AZnzlk1XvdvUeBnXmlld', // American female, strong, confident
  bella: 'EXAVITQu4vr4xnSDxMaL', // American female, soft, gentle
  elli: 'MF3mGyEYCl7XYWbV9V6O', // American female, young, clear
  charlotte: 'XB0fDUnXU5powFXDhCwa', // British female, warm, engaging
  nicole: 'piTKgcLEGmPE4e6mEKli', // American female, soft, whisper
  sarah: 'EXAVITQu4vr4xnSDxMaL', // American female, soft (alias for bella)
  jessica: 'cgSgspJ2msm6clMCkdW9', // American female, expressive
  // Male voices
  adam: 'pNInz6obpgDQGcFmaJgB', // American male, deep, narratior
  antoni: 'ErXwobaYiN019PkySvjV', // American male, well-rounded, calm
  josh: 'TxGEqnHWrfWFTfGW9XjX', // American male, deep, confident
  arnold: 'VR6AewLTigWG4xSOukaG', // American male, crisp, confident
  sam: 'yoZ06aMxZJJ28mfd3POQ', // American male, raspy, dynamic
  callum: 'N2lVS1w4EtoT3dr4eOWO', // British male, intense, transatlantic
  patrick: 'ODq5zmih8GrVes37Dizd', // American male, shouty, energetic
  liam: 'TX3LPaxmHKxFdv7VOQHJ', // American male, young, articulate
  harry: 'SOYHLrjzK2X1ezoPC6cr', // American male, anxious
  clyde: '2EiwWnXFnvU5JabPnv8n', // American male, war veteran
  ethan: 'g5CIjZEefAph4nQFvHAz', // American male, young
  // British voices
  daniel: 'onwK4e9ZLuTAKqWW03F9', // British male, deep, authoritative
  george: 'JBFqnCBsd6RMkjVDRZzb', // British male, warm, raspy
  charlie: 'IKne3meq5aSn9XLyUdCD', // Australian male, casual
  james: 'ZQe5CZNOzWyzPSCn5a3c', // Australian male, calm
  fin: 'D38z5RcWu1voky8WS1ja', // Irish male, sailor
  freya: 'jsCqWAovK2LkecY7zXl4', // American female (legacy)
  // Multilingual / Special
  aria: '9BWtsMINqrJLrRacOk9x', // American female, expressive
  serena: 'pMsXgVXv3BLzUgSXRplE', // American female, pleasant, soft
  glinda: 'z9fAnlkpzviPz146aGWa', // American female, witch
} as const;

export type ElevenLabsVoiceId =
  (typeof ELEVENLABS_VOICES)[keyof typeof ELEVENLABS_VOICES];
export type ElevenLabsVoiceName = keyof typeof ELEVENLABS_VOICES;

/**
 * Voice mapping from Kokoro voices to ElevenLabs voice IDs.
 *
 * Mapping strategy:
 * - American female (af_*): Mapped to female voices (rachel, bella, charlotte)
 * - American male (am_*): Mapped to male voices (adam, josh, sam)
 * - British female (bf_*): Mapped to charlotte (British female)
 * - British male (bm_*): Mapped to daniel or george (British male)
 */
export const VOICE_MAP: Record<KokoroVoice, ElevenLabsVoiceId> = {
  // American Female voices
  af_heart: ELEVENLABS_VOICES.rachel, // Warm, expressive → rachel (calm, narration)
  af_alloy: ELEVENLABS_VOICES.aria, // Neutral, clear → aria (expressive)
  af_aoede: ELEVENLABS_VOICES.elli, // Clear, melodic → elli (young, clear)
  af_bella: ELEVENLABS_VOICES.bella, // Friendly, approachable → bella (soft)
  af_jessica: ELEVENLABS_VOICES.jessica, // Clear, professional → jessica (expressive)
  af_kore: ELEVENLABS_VOICES.charlotte, // Warm, storytelling → charlotte (warm, engaging)
  af_nicole: ELEVENLABS_VOICES.nicole, // Conversational → nicole (soft)
  af_nova: ELEVENLABS_VOICES.domi, // Energetic → domi (strong, confident)
  af_river: ELEVENLABS_VOICES.serena, // Flowing, smooth → serena (pleasant, soft)
  af_sarah: ELEVENLABS_VOICES.bella, // Friendly → bella (alias sarah)
  af_sky: ELEVENLABS_VOICES.elli, // Light, clear → elli (young, clear)
  // American Male voices
  am_adam: ELEVENLABS_VOICES.adam, // Neutral, clear → adam (deep, narrator)
  am_echo: ELEVENLABS_VOICES.antoni, // Conversational → antoni (well-rounded)
  am_eric: ELEVENLABS_VOICES.josh, // Professional → josh (deep, confident)
  am_fenrir: ELEVENLABS_VOICES.adam, // Deep, powerful → adam (deep)
  am_liam: ELEVENLABS_VOICES.liam, // Conversational → liam (young, articulate)
  am_michael: ELEVENLABS_VOICES.antoni, // Neutral → antoni (calm)
  am_onyx: ELEVENLABS_VOICES.josh, // Deep → josh (deep)
  am_puck: ELEVENLABS_VOICES.sam, // Playful → sam (raspy, dynamic)
  am_santa: ELEVENLABS_VOICES.clyde, // Warm, deep → clyde (war veteran style)
  // British Female voices
  bf_emma: ELEVENLABS_VOICES.charlotte, // British female → charlotte
  bf_isabella: ELEVENLABS_VOICES.charlotte, // British female → charlotte
  // British Male voices
  bm_george: ELEVENLABS_VOICES.george, // British male, authoritative → george
  bm_lewis: ELEVENLABS_VOICES.daniel, // British male → daniel (deep, authoritative)
};

/**
 * Map a Kokoro voice to the corresponding ElevenLabs voice ID.
 *
 * @param voice - Kokoro voice identifier
 * @returns The corresponding ElevenLabs voice ID
 */
export function mapKokoroToElevenLabs(voice: KokoroVoice): ElevenLabsVoiceId {
  return VOICE_MAP[voice];
}

/**
 * Get all Kokoro voices that map to a specific ElevenLabs voice.
 *
 * @param voiceId - ElevenLabs voice ID
 * @returns Array of Kokoro voices that map to the given ElevenLabs voice
 */
export function getKokoroVoicesForElevenLabs(
  voiceId: ElevenLabsVoiceId
): KokoroVoice[] {
  return (Object.entries(VOICE_MAP) as [KokoroVoice, ElevenLabsVoiceId][])
    .filter(([, mapped]) => mapped === voiceId)
    .map(([kokoro]) => kokoro);
}

/**
 * Get ElevenLabs voice ID by name.
 *
 * @param name - ElevenLabs voice name (e.g., 'rachel', 'adam')
 * @returns The voice ID or undefined if not found
 */
export function getElevenLabsVoiceId(
  name: string
): ElevenLabsVoiceId | undefined {
  const normalizedName = name.toLowerCase() as ElevenLabsVoiceName;
  return ELEVENLABS_VOICES[normalizedName];
}
