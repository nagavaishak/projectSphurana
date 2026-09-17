import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface TypewriterOptions {
  /** Milliseconds per tick. */
  speed?: number;
  /** Characters revealed per tick (browsers clamp timers ~4ms — raise this,
   *  not `speed`, to type faster). */
  chunk?: number;
  /** Delay before typing starts (ms). */
  startDelay?: number;
  /** When false, holds at 0 revealed chars until flipped true (for chaining). */
  enabled?: boolean;
  /** Fired once when the full string has been revealed. */
  onDone?: () => void;
}

/**
 * Reveals `text` one character at a time so Claire's copy reads as if she's
 * typing it. Retypes whenever `text` changes. Respects reduced-motion and,
 * when disabled, reveals nothing until enabled (lets a description wait for
 * its headline to finish).
 */
export function useTypewriter(
  text: string,
  {
    speed = 18,
    chunk = 1,
    startDelay = 0,
    enabled = true,
    onDone,
  }: TypewriterOptions = {}
) {
  const [count, setCount] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    if (prefersReducedMotion()) {
      setCount(text.length);
      onDoneRef.current?.();
      return;
    }

    setCount(0);
    let i = 0;
    let tick: ReturnType<typeof setTimeout>;
    const start = setTimeout(function step() {
      i = Math.min(i + chunk, text.length);
      setCount(i);
      if (i >= text.length) {
        onDoneRef.current?.();
        return;
      }
      tick = setTimeout(step, speed);
    }, startDelay);

    return () => {
      clearTimeout(start);
      clearTimeout(tick);
    };
  }, [text, speed, chunk, startDelay, enabled]);

  return { revealed: text.slice(0, count), done: count >= text.length };
}
