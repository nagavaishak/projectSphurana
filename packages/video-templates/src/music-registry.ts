export interface TemplateMusicTrack {
  id: string;
  name: string;
  /** Path relative to CDN root, e.g. "/public/audio/tea-pop.mp3" */
  path: string;
  duration: number;
  artist?: string;
  /** Beats per minute for beat-synced b-roll transitions */
  bpm: number;
  /** Optional mood tag used by the slot resolver to match {kind:'music',mood}. */
  mood?: string;
}

/**
 * Shared music library available to all templates.
 * URLs point to audio files on the CDN (S3 public assets bucket).
 */
export const SHARED_MUSIC_TRACKS: TemplateMusicTrack[] = [
  {
    id: 'tea-pop',
    name: 'Tea Pop',
    path: '/public/audio/tea-pop.mp3',
    duration: 102,
    bpm: 110,
  },
  {
    id: 'disco-divas',
    name: 'Disco Divas',
    path: '/public/audio/disco-divas.mp3',
    duration: 105,
    bpm: 123,
  },
  {
    id: 'essence-of-light',
    name: 'Essence of Light',
    path: '/public/audio/essence-of-light.mp3',
    duration: 92,
    bpm: 100,
  },
  {
    id: 'for-me',
    name: 'For Me',
    path: '/public/audio/for-me.mp3',
    duration: 112,
    bpm: 97,
  },
  {
    id: 'smoky',
    name: 'Smoky',
    path: '/public/audio/smoky.mp3',
    duration: 94,
    bpm: 100,
  },
  {
    id: 'taka-taka',
    name: 'Taka Taka',
    path: '/public/audio/taka-taka.mp3',
    duration: 99,
    bpm: 108,
  },
  {
    id: 'uncovered',
    name: 'Uncovered',
    path: '/public/audio/uncovered.mp3',
    duration: 110,
    bpm: 80,
  },
  {
    id: 'back-then',
    name: 'Back Then',
    path: '/public/audio/back-then.mp3',
    duration: 184,
    bpm: 90,
  },
  {
    id: 'sweet',
    name: 'Sweet',
    path: '/public/audio/sweet.mp3',
    duration: 189,
    bpm: 121,
  },
  {
    id: 'leaning-off-your-love',
    name: 'Leaning Off Your Love',
    path: '/public/audio/leaning-off-your-love.mp3',
    duration: 247,
    bpm: 109,
  },
];

export function getMusicTrackById(id: string): TemplateMusicTrack | undefined {
  return SHARED_MUSIC_TRACKS.find((track) => track.id === id);
}
