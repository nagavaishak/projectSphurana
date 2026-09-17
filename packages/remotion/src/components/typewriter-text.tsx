import type React from 'react';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { StrokedText, strokedTextStyleSchema } from './stroked-text';

export const typewriterTextSchema = z
  .object({
    text: z.string().default('Hello, world.'),
    charsPerSecond: z.number().min(1).max(60).default(18),
    // ± frames of randomness on each character's appearance time
    jitterFrames: z.number().min(0).max(20).default(3),
    // multipliers for the gap AFTER specific characters (in units of base char-time)
    spacePauseMultiplier: z.number().min(0).max(10).default(0.6),
    commaPauseMultiplier: z.number().min(0).max(20).default(3),
    sentencePauseMultiplier: z.number().min(0).max(40).default(6),
    // deterministic seed so renders are reproducible
    seed: z.number().int().default(1),
    startFrame: z.number().int().min(0).default(0),
    showCursor: z.boolean().default(true),
    cursorChar: z.string().default('|'),
    // frames per cursor blink phase (on or off)
    cursorBlinkFrames: z.number().int().min(1).max(120).default(15),
    // keep cursor visible after typing finishes
    cursorPersists: z.boolean().default(true),
  })
  .merge(strokedTextStyleSchema);

export type TypewriterTextProps = z.infer<typeof typewriterTextSchema>;

// Small deterministic PRNG so jitter is stable across renders.
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface CharSchedule {
  appearFrame: number;
}

const buildSchedule = (
  text: string,
  fps: number,
  cps: number,
  jitterFrames: number,
  spaceMult: number,
  commaMult: number,
  sentMult: number,
  seed: number
): CharSchedule[] => {
  const framesPerChar = fps / cps;
  const rand = mulberry32(seed);
  const schedule: CharSchedule[] = [];
  let cursor = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    let extra = 0;
    if (/[.!?]/.test(ch)) extra = framesPerChar * sentMult;
    else if (/[,;:]/.test(ch)) extra = framesPerChar * commaMult;
    else if (ch === ' ') extra = framesPerChar * spaceMult;
    const jitter = (rand() * 2 - 1) * jitterFrames;
    cursor += framesPerChar + extra + jitter;
    schedule.push({ appearFrame: Math.max(0, Math.round(cursor)) });
  }
  return schedule;
};

export const TypewriterText: React.FC<TypewriterTextProps> = (props) => {
  const {
    text,
    charsPerSecond,
    jitterFrames,
    spacePauseMultiplier,
    commaPauseMultiplier,
    sentencePauseMultiplier,
    seed,
    startFrame,
    showCursor,
    cursorChar,
    cursorBlinkFrames,
    cursorPersists,
    ...styleProps
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const schedule = useMemo(
    () =>
      buildSchedule(
        text,
        fps,
        charsPerSecond,
        jitterFrames,
        spacePauseMultiplier,
        commaPauseMultiplier,
        sentencePauseMultiplier,
        seed
      ),
    [
      text,
      fps,
      charsPerSecond,
      jitterFrames,
      spacePauseMultiplier,
      commaPauseMultiplier,
      sentencePauseMultiplier,
      seed,
    ]
  );

  const localFrame = frame - startFrame;
  if (localFrame < 0) {
    // before the typewriter starts
    return showCursor ? (
      <StrokedText {...styleProps}>{cursorChar}</StrokedText>
    ) : null;
  }

  let visibleCount = 0;
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    if (entry && entry.appearFrame <= localFrame) visibleCount = i + 1;
    else break;
  }

  const visibleText = text.slice(0, visibleCount);
  const finished = visibleCount >= text.length;

  const cursorOn =
    showCursor &&
    (!finished || cursorPersists) &&
    Math.floor(localFrame / cursorBlinkFrames) % 2 === 0;

  return (
    <StrokedText {...styleProps}>
      {visibleText}
      {cursorOn ? cursorChar : ''}
    </StrokedText>
  );
};
