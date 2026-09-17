// Animation registry (§9). Maps an AnimationToken to a frame-by-frame preset
// that emits opacity / transform / clipPath. The interpreter calls
// getAnimationPreset(token, params?) and applies the returned style at every
// frame of the block's local timeline.
//
// All presets were extracted from the legacy v1 renderer:
//   - educational-text-layer.tsx (slide-up, pop, spring-in lead/items)
//   - text-interstitial.tsx (spring scale-in + fade in/out)
//   - pip-overlay-layer.tsx (slide from edge)
//   - full-screen-reveal.tsx (ken-burns zoom, mask-wipe)
// typewriter was new for wave-3 (no legacy counterpart) and follows the
// same opacity-only contract — actual text-cropping happens in the block.

import type { AnimationToken } from '@borradh-workspace/video-templates';
import { interpolate, spring } from 'remotion';

export interface AnimationStyle {
  opacity?: number;
  transform?: string;
  /** Used by ken-burns when the origin matters. */
  transformOrigin?: string;
  /** Optional CSS clip-path; used by mask-wipe etc. */
  clipPath?: string;
  /**
   * 0–1 progress for animations whose semantic output isn't a CSS string
   * (typewriter slices its text by this value). Blocks that don't care
   * ignore the field.
   */
  progress?: number;
}

// Per-animation bounded params. Each entry is optional and has a sane default.
// Animations that don't take params (fade-in) still accept the same call site —
// extra params are ignored.
export interface AnimationParams {
  /** Pixel distance for slide-* animations. Default: 60. */
  slideDistance?: number;
  /** Ken-burns origin. Default: 'center'. */
  kenBurnsFrom?: 'center' | 'left' | 'right';
  /** Ken-burns zoom range [start, end]. Default: [1.0, 1.12]. */
  kenBurnsZoomRange?: [number, number];
  /** typewriter progress 0–1; the block uses this to slice text. */
  typewriterProgress?: number;
}

export type AnimationPreset = (
  frame: number,
  durationFrames: number,
  fps: number,
  params?: AnimationParams
) => AnimationStyle;

const DEFAULT_ENTRANCE_FRAMES = 12;

// Spring config tuned to match the wave-2 helper output bit-for-bit so
// regression on educational-1 is zero.
const ENTRANCE_SPRING_CONFIG = {
  damping: 18,
  stiffness: 100,
  mass: 0.8,
} as const;

const POP_SPRING_CONFIG = {
  damping: 20,
  stiffness: 120,
  mass: 0.8,
} as const;

function clampedFade(localFrame: number, durationFrames: number): number {
  const span = Math.max(1, durationFrames);
  return interpolate(localFrame, [0, span], [0, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
}

const fadeIn: AnimationPreset = (frame, duration) => ({
  opacity: clampedFade(
    frame,
    duration === 0 ? DEFAULT_ENTRANCE_FRAMES : duration
  ),
  transform: 'translate3d(0,0,0)',
});

function makeSlide(axis: 'X' | 'Y', sign: 1 | -1): AnimationPreset {
  return (frame, duration, fps, params) => {
    if (frame <= 0) return { opacity: 0, transform: 'translate3d(0,0,0)' };
    const span = duration > 0 ? duration : DEFAULT_ENTRANCE_FRAMES;
    const opacity = clampedFade(frame, span);
    const offset = params?.slideDistance ?? 60;
    const s = spring({
      frame,
      fps,
      config: ENTRANCE_SPRING_CONFIG,
    });
    const v = interpolate(s, [0, 1], [sign * offset, 0]);
    return {
      opacity,
      transform: `translate${axis}(${v}px)`,
    };
  };
}

const slideUp = makeSlide('Y', 1);
const slideDown = makeSlide('Y', -1);
const slideLeft = makeSlide('X', 1);
const slideRight = makeSlide('X', -1);

const pop: AnimationPreset = (frame, duration, fps) => {
  if (frame <= 0) return { opacity: 0, transform: 'scale(0.85)' };
  const span = duration > 0 ? duration : DEFAULT_ENTRANCE_FRAMES;
  const opacity = clampedFade(frame, span);
  const s = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });
  return {
    opacity,
    transform: `scale(${interpolate(s, [0, 1], [0.85, 1])})`,
  };
};

const springIn: AnimationPreset = (frame, duration, fps) => {
  if (frame <= 0) return { opacity: 0, transform: 'scale(0.92)' };
  const span = duration > 0 ? duration : DEFAULT_ENTRANCE_FRAMES;
  const opacity = clampedFade(frame, span);
  const s = spring({
    frame,
    fps,
    config: POP_SPRING_CONFIG,
  });
  return {
    opacity,
    transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})`,
  };
};

const kenBurns: AnimationPreset = (frame, duration, _fps, params) => {
  const [from, to] = params?.kenBurnsZoomRange ?? [1.0, 1.12];
  const span = Math.max(1, duration);
  const progress = interpolate(frame, [0, span], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(progress, [0, 1], [from, to]);
  const origin = params?.kenBurnsFrom ?? 'center';
  const originStr =
    origin === 'left' ? '20% 50%' : origin === 'right' ? '80% 50%' : '50% 50%';
  return {
    transform: `scale(${scale})`,
    transformOrigin: originStr,
    opacity: 1,
  };
};

const maskWipe: AnimationPreset = (frame, duration) => {
  // Horizontal wipe — inset() shrinks the right edge from 100% to 0% across
  // the entrance window. Element is fully opaque throughout.
  const span = duration > 0 ? duration : DEFAULT_ENTRANCE_FRAMES;
  const progress = interpolate(frame, [0, span], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return {
    opacity: 1,
    transform: 'translate3d(0,0,0)',
    clipPath: `inset(0 ${100 - progress}% 0 0)`,
  };
};

const typewriter: AnimationPreset = (frame, duration, _fps, params) => {
  // The block (text overlay) drives the actual character slicing using
  // `progress`. The preset emits a stable opacity/transform; blocks that
  // wire typewriter read `progress` to slice the visible substring.
  const span = duration > 0 ? duration : DEFAULT_ENTRANCE_FRAMES;
  const progress =
    params?.typewriterProgress ??
    interpolate(frame, [0, span], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return {
    opacity: 1,
    transform: 'translate3d(0,0,0)',
    progress,
  };
};

const PRESETS: Record<AnimationToken, AnimationPreset> = {
  // Static: visible immediately, no motion.
  none: () => ({ opacity: 1, transform: 'none' }),
  'fade-in': fadeIn,
  'slide-up': slideUp,
  'slide-down': slideDown,
  'slide-left': slideLeft,
  'slide-right': slideRight,
  pop,
  'spring-in': springIn,
  'ken-burns': kenBurns,
  'mask-wipe': maskWipe,
  typewriter,
  // Passthrough: the per-word fade+rise is done by the text/list block, which
  // splits the string and staggers each word. The element-level style stays
  // stable so it doesn't fight the per-word animation.
  'word-by-word': () => ({ opacity: 1, transform: 'none' }),
};

export function getAnimationPreset(token: AnimationToken): AnimationPreset {
  return PRESETS[token];
}

// Per-word fade+rise reveal (v1 fade-benefits). Returns the opacity + Y-offset
// for a word at `index`, given the element's local frame. Generic — any block
// that lays out words can use it. Defaults mirror the v1 cadence.
export function wordRevealStyle(
  index: number,
  localFrame: number,
  opts?: { fadeFrames?: number; staggerFrames?: number; risePx?: number }
): { opacity: number; transform: string } {
  const fade = opts?.fadeFrames ?? 7;
  const stagger = opts?.staggerFrames ?? 4;
  const rise = opts?.risePx ?? 14;
  const start = index * stagger;
  const appear = interpolate(localFrame, [start, start + fade], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return {
    opacity: appear,
    transform: `translateY(${interpolate(appear, [0, 1], [rise, 0])}px)`,
  };
}

// Helper for blocks that drive a typewriter slice — returns the visible
// substring at the current local frame, no need to call the preset.
export function computeTypewriterProgress(
  localFrame: number,
  durationFrames: number
): number {
  if (durationFrames <= 0) return 1;
  return interpolate(localFrame, [0, durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}
