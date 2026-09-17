import { defineCoverage } from '../coverage.types.js';

/**
 * APP-VERSION — 1 endpoint, 0 tools. The native app's boot-time check of
 * whether the binary it is running is still supported.
 *
 * Not a tool, for the same reason the health probes aren't: the answer is
 * about THE CALLER, not about the account. The endpoint takes the platform and
 * version of the binary making the request and compares them against a floor —
 * so the only meaningful caller is a client that knows its own build. Claire
 * runs server-side and has no binary; asking on a user's behalf would mean
 * inventing a version string, and inventing the input to a check whose output
 * can hard-block an app is the wrong kind of helpful.
 *
 * If an owner ever asks Claire "am I on the latest version?", the honest answer
 * comes from the app itself — which already shows them, via a toast when a
 * newer version exists and a blocking screen when theirs is unsupported.
 */
export const appVersionCoverage = defineCoverage('app-version', {
  'GET /app-version/check': {
    notExposed:
      'Answers about the calling binary, not the account: it compares the caller’s own platform and version against the supported floor. Claire has no binary of her own, so she could only answer by inventing a version string — and this check’s output can hard-block an app.',
  },
});
