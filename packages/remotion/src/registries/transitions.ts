// Transitions registry (§9). Maps a TransitionToken to a (durationFrames, apply)
// pair used between consecutive clips on a media-track. The block runs the
// transition for the first `durationFrames` of every clip (except clip 0),
// reading `apply` to get matching outgoing/incoming styles.
//
// Extracted from the legacy full-screen-reveal.tsx transition cases ('fade',
// 'slide-left', 'slide-right', 'wipe' → mapped to the four tokens).

import type { TransitionToken } from '@borradh-workspace/video-templates';
import type { CSSProperties } from 'react';
import { interpolate } from 'remotion';

export interface TransitionEntry {
  /** How long the transition spans, in absolute frames. */
  durationFrames: (fps: number) => number;
  /**
   * Returns CSS for the outgoing and incoming clip at `frame` (0…duration-1).
   * Both layers are stacked; the renderer applies outgoing to the previous
   * clip and incoming to the new clip.
   */
  apply: (
    frame: number,
    fps: number
  ) => { outgoing: CSSProperties; incoming: CSSProperties };
}

const DEFAULT_TRANSITION_FRAMES = 8;

function fadeApply(
  frame: number,
  _fps: number
): {
  outgoing: CSSProperties;
  incoming: CSSProperties;
} {
  const span = DEFAULT_TRANSITION_FRAMES;
  const t = interpolate(frame, [0, span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return {
    outgoing: { opacity: 1 - t },
    incoming: { opacity: t },
  };
}

function slideApply(
  frame: number,
  _fps: number
): {
  outgoing: CSSProperties;
  incoming: CSSProperties;
} {
  const span = DEFAULT_TRANSITION_FRAMES;
  const t = interpolate(frame, [0, span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return {
    outgoing: { transform: `translateX(${-100 * t}%)` },
    incoming: { transform: `translateX(${100 * (1 - t)}%)` },
  };
}

function wipeApply(
  frame: number,
  _fps: number
): {
  outgoing: CSSProperties;
  incoming: CSSProperties;
} {
  const span = DEFAULT_TRANSITION_FRAMES;
  const pct = interpolate(frame, [0, span], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return {
    outgoing: { clipPath: `inset(0 ${pct}% 0 0)` },
    incoming: { clipPath: `inset(0 0 0 ${100 - pct}%)` },
  };
}

const IDENTITY: CSSProperties = {};

const TRANSITIONS: Record<TransitionToken, TransitionEntry> = {
  cut: {
    durationFrames: () => 0,
    apply: () => ({ outgoing: IDENTITY, incoming: IDENTITY }),
  },
  fade: {
    durationFrames: () => DEFAULT_TRANSITION_FRAMES,
    apply: fadeApply,
  },
  slide: {
    durationFrames: () => DEFAULT_TRANSITION_FRAMES,
    apply: slideApply,
  },
  wipe: {
    durationFrames: () => DEFAULT_TRANSITION_FRAMES,
    apply: wipeApply,
  },
};

export function getTransition(token: TransitionToken): TransitionEntry {
  return TRANSITIONS[token];
}
