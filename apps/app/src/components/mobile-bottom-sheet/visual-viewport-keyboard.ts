/** Gap between layout viewport and visual viewport (keyboard / browser chrome). */
export const KEYBOARD_INSET_THRESHOLD_PX = 24;

export function getVisualViewportKeyboardGap(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const vv = window.visualViewport;
  if (!vv) {
    return 0;
  }

  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

export function isVisualViewportKeyboardOpen(): boolean {
  return getVisualViewportKeyboardGap() > KEYBOARD_INSET_THRESHOLD_PX;
}

/**
 * Height for sizing full sheets — always the full layout viewport.
 *
 * Deliberately NOT shrunk to `visualViewport.height` while the keyboard is
 * open: the keyboard is handled by lifting sheet *content* (the
 * `keyboardAware` bottom padding in `MobileBottomSheet`), not by shrinking
 * the sheet. Doing both subtracted the keyboard height twice and crushed the
 * sheet body to a blank strip. `window.innerHeight` is stable across keyboard
 * toggles (the iOS keyboard overlays the WebView), so it never goes stale.
 */
export function getLayoutViewportHeight(): number {
  if (typeof window === 'undefined') {
    return 844;
  }

  return window.innerHeight;
}

export function getKeyboardBottomInset(): number {
  const gap = getVisualViewportKeyboardGap();
  return gap > KEYBOARD_INSET_THRESHOLD_PX ? gap : 0;
}

export function subscribeVisualViewportChanges(
  onChange: () => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const vv = window.visualViewport;
  const sync = () => onChange();

  const onFocusOut = () => {
    sync();
    requestAnimationFrame(sync);
    window.setTimeout(sync, 120);
    window.setTimeout(sync, 320);
  };

  vv?.addEventListener('resize', sync);
  vv?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  document.addEventListener('focusout', onFocusOut, true);

  return () => {
    vv?.removeEventListener('resize', sync);
    vv?.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
    document.removeEventListener('focusout', onFocusOut, true);
  };
}
