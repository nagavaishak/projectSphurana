// Types
export * from './types/index';

// Components
export * from './components/index';

// Block registry (renderer side)
export * from './blocks/index';

// Registries (renderer-side: animations, fonts, transitions, sfx)
export * from './registries/index';

// Re-export useful Remotion utilities for convenience
export { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
export type { PlayerRef } from '@remotion/player';
