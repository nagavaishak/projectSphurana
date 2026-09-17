/** Capacitor WebView origins when loading bundled `dist` (no dev server). */
const CAPACITOR_BUNDLED_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

function isAllowedNativeOrigin(origin: string): boolean {
  if (CAPACITOR_BUNDLED_ORIGINS.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname.endsWith('.borradh.io') ||
      hostname.endsWith('.borradh-dev.com')
    );
  } catch {
    return false;
  }
}

export function runtimeConfigCorsHeaders(
  request: Request
): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'public, s-maxage=60, stale-while-revalidate=30',
  };

  if (origin && isAllowedNativeOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
    headers.Vary = 'Origin';
  }

  return headers;
}
