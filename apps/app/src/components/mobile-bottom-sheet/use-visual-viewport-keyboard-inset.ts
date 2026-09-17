import { useSyncExternalStore } from 'react';

import {
  getKeyboardBottomInset,
  subscribeVisualViewportChanges,
} from './visual-viewport-keyboard';

function subscribeKeyboardInset(onStoreChange: () => void) {
  let prev = getKeyboardBottomInset();

  return subscribeVisualViewportChanges(() => {
    const next = getKeyboardBottomInset();
    if (next === prev) {
      return;
    }
    prev = next;
    onStoreChange();
  });
}

function getKeyboardInsetSnapshot(): number {
  return getKeyboardBottomInset();
}

function getServerKeyboardInsetSnapshot(): number {
  return 0;
}

/**
 * Bottom inset when the on-screen keyboard shrinks `visualViewport`.
 * Resets when the keyboard dismisses (including delayed iOS WebView sync).
 */
export function useVisualViewportKeyboardInset(): number {
  return useSyncExternalStore(
    subscribeKeyboardInset,
    getKeyboardInsetSnapshot,
    getServerKeyboardInsetSnapshot
  );
}
