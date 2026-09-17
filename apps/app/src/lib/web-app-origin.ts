/**
 * Origins the WebView reports when it is serving bundled assets from disk
 * rather than a real web host (`cap sync`, no live reload).
 *
 * Shared with {@link import('./runtime-config-url').getRuntimeConfigFetchUrl},
 * which has to answer the same question for a different reason.
 */
export const BUNDLED_CAPACITOR_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

/**
 * The app's PUBLIC https origin — the one an outside party can actually reach.
 *
 * `window.location.origin` answers a different question: what the WebView
 * loaded from. In a browser those coincide, so it reads as the app's address
 * and got used as one in nine places. Inside the Capacitor WebView they do not:
 * the origin is `capacitor://localhost` (iOS) or `https://localhost` (Android).
 *
 * That value is a *well-formed* URL, so it passes every `z.string().url()` on
 * the way out and only fails at the far edge, where the error no longer names
 * the origin as the cause. Stripe rejected it with a bare `Not a valid URL`,
 * surfacing to the user as "sorry, try again" on every native device while the
 * same button worked in every desktop browser.
 *
 * Where the value is shown or handed to someone else — a shared booking link, a
 * QR code — the failure is quieter still: no error at all, just a
 * `capacitor://localhost/book/…` link that is useless to whoever receives it.
 *
 * So: use this for any URL that LEAVES the app (payment provider return URLs,
 * OAuth redirects, shared links, QR codes). Keep `window.location.origin` only
 * for comparing against the current document's own origin.
 */
export function getWebAppOrigin(): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : undefined;

  if (origin && !BUNDLED_CAPACITOR_ORIGINS.has(origin)) {
    return origin;
  }

  // Native (or SSR): fall back to the configured public host. `VITE_APP_URL` is
  // baked at build time for native bundles — see `reference_capacitor_runtime_config_cors`.
  return (
    import.meta.env.VITE_APP_URL?.replace(/\/$/, '') || 'https://app.borradh.io'
  );
}

/**
 * {@link getWebAppOrigin} joined to a path — the shape almost every call site
 * actually wants, so none of them has to remember the leading slash.
 */
export function webAppUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getWebAppOrigin()}${suffix}`;
}
