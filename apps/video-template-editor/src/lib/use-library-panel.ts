import { useSyncExternalStore } from 'react';

// Tiny vanilla store for the library panel's open/closed state. Kept outside
// the editor store so opening the panel never invalidates anything that
// subscribes to the doc.

let open = false;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const notify = (): void => {
  for (const cb of listeners) cb();
};

const getSnapshot = (): boolean => open;

export const useLibraryPanelOpen = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const openLibraryPanel = (): void => {
  if (open) return;
  open = true;
  notify();
};

export const closeLibraryPanel = (): void => {
  if (!open) return;
  open = false;
  notify();
};

export const toggleLibraryPanel = (): void => {
  open = !open;
  notify();
};
