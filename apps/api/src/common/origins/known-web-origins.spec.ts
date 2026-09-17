/**
 * This list is now load-bearing for more than CORS: `publicReturnUrl()` uses it
 * to decide which origins Stripe may redirect a user to. A pattern that matches
 * too loosely is an open redirect, so the near-miss cases are pinned here.
 */
import { isKnownWebOrigin } from './known-web-origins.js';

describe('isKnownWebOrigin', () => {
  it.each([
    'https://app.borradh.io',
    'https://www.borradh.io',
    'http://localhost:5173',
    // A native WebView really sends these — allowed for CORS. They are NOT
    // usable as redirect targets, which `publicReturnUrl()` rules out before
    // ever consulting this list.
    'capacitor://localhost',
    'https://localhost',
    'https://borradh-app-git-feat-x-borradh-technologies.vercel.app',
    'https://borradh-marketing-abc123-borradh-technologies.vercel.app',
    'https://app.pavit.borradh-dev.com',
  ])('accepts our origin %s', (origin) => {
    expect(isKnownWebOrigin(origin)).toBe(true);
  });

  it.each([
    'https://evil.com',
    // Suffix attacks on each pattern — the anchors are the whole defence.
    'https://app.borradh.io.evil.com',
    'https://app.borradh-dev.com.evil.co',
    'https://borradh-app-git-x-someone-else.vercel.app',
    'https://borradh-app-x-borradh-technologies.vercel.app.evil.co',
    // An origin is scheme + host + port and nothing else; a path never matches.
    'https://app.borradh.io/settings',
  ])('rejects %s', (origin) => {
    expect(isKnownWebOrigin(origin)).toBe(false);
  });
});
