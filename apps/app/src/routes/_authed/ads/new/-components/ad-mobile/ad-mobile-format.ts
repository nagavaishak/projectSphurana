/** Format milliseconds as M:SS (e.g. 0:30). */
export function formatVideoDurationMs(
  durationMs: string | number | null | undefined
): string | null {
  if (durationMs === null || durationMs === undefined || durationMs === '') {
    return null;
  }
  const ms = typeof durationMs === 'string' ? Number(durationMs) : durationMs;
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Format asset duration stored in seconds. */
export function formatAssetDurationSeconds(
  duration: string | number | null | undefined
): string | null {
  if (duration === null || duration === undefined || duration === '') {
    return null;
  }
  const seconds = typeof duration === 'string' ? Number(duration) : duration;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
