import { z } from 'zod';

// Animation token registry (§9). Templates cite these by token; wave 3 wires
// each token to a concrete preset on the renderer side.
//
// Adding a new entrance/exit animation:
//   1. Add the token here.
//   2. Add a renderer-side preset under packages/remotion that maps the token
//      to actual interpolate/spring values.
export const ANIMATION_TOKENS = [
  // No entrance — element is fully visible immediately (static "just show"
  // templates like ins-outs).
  'none',
  'fade-in',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'pop',
  'spring-in',
  'ken-burns',
  'mask-wipe',
  'typewriter',
  // Reveals text one word at a time (each word fades + rises in), then holds.
  // Block-driven: the renderer splits the text and staggers the words.
  'word-by-word',
] as const;

export type AnimationToken = (typeof ANIMATION_TOKENS)[number];

export const animationRef = z.enum(ANIMATION_TOKENS);
