/**
 * Recovers from stale dynamic-import / chunk-load failures.
 *
 * After a new deploy, clients still holding the previous `index.html` request
 * hashed asset chunks (e.g. `/assets/index-DSGiT2Sy.js`) that no longer exist
 * on the server. Lazy route/component imports then reject with "Load failed" /
 * "Failed to fetch dynamically imported module". A transient network blip on a
 * lazy chunk produces the same symptom.
 *
 * The fix is a one-time hard reload, which re-fetches the current `index.html`
 * and the asset hashes it references. A sessionStorage flag guards against an
 * infinite reload loop when the reload itself can't recover (e.g. the asset is
 * genuinely gone / persistent offline).
 */

const RELOAD_GUARD_KEY = 'borradh:chunk-reload-attempted';

function warnChunkReload(message: string, extra?: Record<string, unknown>) {
  console.warn('[app.chunkReload]', message, extra ?? '');
}

/** Heuristics for a dynamic-import / chunk-load failure across browsers. */
function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!message) return false;
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Load failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

/**
 * Reload the page once to pick up fresh chunk hashes. Returns `true` when a
 * reload was triggered, `false` when the guard already fired this session.
 */
function reloadOnceForStaleChunk(reason: string): boolean {
  let alreadyAttempted = false;
  try {
    alreadyAttempted = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
  } catch {
    // sessionStorage can throw (private mode / disabled storage); fall back to
    // not reloading rather than risk a loop we can't track.
    alreadyAttempted = true;
  }

  if (alreadyAttempted) {
    warnChunkReload('Stale chunk after reload — not retrying', { reason });
    return false;
  }

  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    // If we can't persist the guard we'd risk an infinite loop, so bail out.
    return false;
  }

  warnChunkReload('Reloading to recover from stale chunk', { reason });
  window.location.reload();
  return true;
}

/**
 * Clear the reload guard once the app has booted successfully, so a future
 * stale-deploy in the same tab can recover again.
 */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // ignore
  }
}

/**
 * Install global listeners that auto-recover from stale chunk loads. Call once
 * at app entry, before the router mounts.
 */
export function installChunkReloadHandler(): void {
  // Vite emits this when a module preload (lazy route/component) fails.
  window.addEventListener('vite:preloadError', (event) => {
    const detail = (event as Event & { payload?: unknown }).payload;
    const isChunkError = detail === undefined || isChunkLoadError(detail);
    if (isChunkError && reloadOnceForStaleChunk('vite:preloadError')) {
      // Prevent Vite from throwing the unhandled preload error before we reload.
      event.preventDefault();
    }
    if (detail instanceof Error && !isChunkError) {
      // Non-chunk preload error — surface it for visibility.
      warnChunkReload('preloadError (non-chunk)', { message: detail.message });
    }
  });

  // Catch dynamic-import rejections that don't surface via vite:preloadError
  // (e.g. a lazy import awaited inside a loader without a preload step).
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      if (reloadOnceForStaleChunk('unhandledrejection')) {
        event.preventDefault();
      }
    }
  });
}
