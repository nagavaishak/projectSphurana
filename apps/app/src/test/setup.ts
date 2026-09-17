// Global setup for apps/app component/unit tests.
// Registers jest-dom matchers (toBeVisible, toHaveTextContent, …) on vitest's
// expect, and clears the DOM + mocks between tests so specs stay isolated.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom ships no matchMedia. `useIsMobile()` (and anything else that asks the
// viewport a question) needs one, so specs default to the desktop breakpoint —
// a spec that wants the mobile branch overrides window.innerWidth/matchMedia.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom implements neither URL.createObjectURL nor URL.revokeObjectURL. Any
// component that previews a picked File — the image-crop dialog behind the
// team-member photo step — calls them during render and would throw
// "URL.createObjectURL is not a function". Stub them to a harmless blob: URL.
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  URL.createObjectURL = (() => 'blob:mock') as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
