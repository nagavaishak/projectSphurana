import type { PlayerRef } from '@remotion/player';
import type { MutableRefObject } from 'react';

// Module-level singleton ref to the (single) Player mounted at the app root.
// The Player is mounted once in preview-pane.tsx; treating its ref as a module
// singleton lets other panes (e.g. the timeline) drive the playhead without
// threading context through every component.
export const playerRef: MutableRefObject<PlayerRef | null> = {
  current: null,
};

// Last frame reported by the Player's `frameupdate` event. Kept in module
// state so synchronous callers (`getCurrentFrame()`) don't need to wait for
// a render. Also seeded by `seekTo` so manual scrubs reflect immediately.
let lastFrame = 0;

type FrameListener = (frame: number) => void;
const frameListeners = new Set<FrameListener>();

const notifyFrame = (frame: number) => {
  if (frame === lastFrame) return;
  lastFrame = frame;
  for (const cb of frameListeners) {
    cb(frame);
  }
};

// Bound once when a ref is attached so we can remove it on detach.
const handleFrameUpdate = (e: { detail: { frame: number } }) => {
  notifyFrame(e.detail.frame);
};
const handleSeeked = (e: { detail: { frame: number } }) => {
  notifyFrame(e.detail.frame);
};

export function attachPlayerRef(ref: PlayerRef | null): () => void {
  // Detach the previously-attached ref's listeners before swapping.
  if (playerRef.current && playerRef.current !== ref) {
    try {
      playerRef.current.removeEventListener('frameupdate', handleFrameUpdate);
      playerRef.current.removeEventListener('seeked', handleSeeked);
    } catch {
      // Player may have already torn down — safe to ignore.
    }
  }

  playerRef.current = ref;

  if (ref) {
    ref.addEventListener('frameupdate', handleFrameUpdate);
    ref.addEventListener('seeked', handleSeeked);
    // Seed `lastFrame` from the Player's current value so the first paint
    // reflects whatever frame the Player initialised at.
    try {
      notifyFrame(ref.getCurrentFrame());
    } catch {
      // getCurrentFrame can throw if called before the Player mounts.
    }
  }

  return () => {
    if (playerRef.current === ref) {
      if (ref) {
        try {
          ref.removeEventListener('frameupdate', handleFrameUpdate);
          ref.removeEventListener('seeked', handleSeeked);
        } catch {
          // ignore
        }
      }
      playerRef.current = null;
    }
  };
}

export function seekTo(frame: number): void {
  const clamped = Math.max(0, Math.floor(frame));
  // Update local state immediately so the timeline playhead doesn't lag a
  // tick behind the click while we wait for the Player's `seeked` event.
  notifyFrame(clamped);
  playerRef.current?.seekTo(clamped);
}

export function getCurrentFrame(): number {
  return lastFrame;
}

export function subscribeToFrame(cb: FrameListener): () => void {
  frameListeners.add(cb);
  return () => {
    frameListeners.delete(cb);
  };
}
