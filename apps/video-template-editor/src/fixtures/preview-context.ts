import { SHARED_MUSIC_TRACKS } from '@borradh-workspace/video-templates';

// Preview context — stub values the in-browser synthesizer uses to fill query
// slots when no real org/asset library is available. Picked to be small and
// public so the Player can stream them without auth.

export interface PreviewBrand {
  primaryColor: string;
  logoUrl: string;
  businessName: string;
  tagline?: string;
}

export interface PreviewContext {
  /** Public sample video URLs used to satisfy asset-clips / asset-media slots. */
  clipUrls: string[];
  /** Public sample image URLs (image fallback for asset-media). */
  imageUrls: string[];
  /** Multi-line stub script, one line per role-derived slice. */
  script: string;
  /** Stub brand kit values for brand slots. */
  brand: PreviewBrand;
  /** Music track id picked from SHARED_MUSIC_TRACKS. */
  musicTrackId: string;
  /** Default music volume when a music slot resolves. */
  musicVolume: number;
}

export const PREVIEW_CONTEXT: PreviewContext = {
  clipUrls: [
    'https://download.samplelib.com/mp4/sample-5s.mp4',
    'https://download.samplelib.com/mp4/sample-10s.mp4',
    'https://download.samplelib.com/mp4/sample-15s.mp4',
    'https://download.samplelib.com/mp4/sample-20s.mp4',
  ],
  imageUrls: [
    'https://download.samplelib.com/jpeg/sample-clouds-400x300.jpg',
    'https://download.samplelib.com/jpeg/sample-birch-400x300.jpg',
  ],
  script: [
    'What no one tells you about treatments',
    'Most clinics rush the consult',
    'You leave with more questions than answers',
    'We sit with every client for 30 minutes',
    'DM us to book a free consult',
  ].join('\n'),
  brand: {
    primaryColor: '#6aa9ff',
    logoUrl: 'https://download.samplelib.com/jpeg/sample-clouds-400x300.jpg',
    businessName: 'Preview Studio',
  },
  musicTrackId: SHARED_MUSIC_TRACKS[0]?.id ?? 'tea-pop',
  musicVolume: 0.6,
};
