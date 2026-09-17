import { z } from 'zod';

/**
 * A URL the CLIENT supplies that a THIRD PARTY will later navigate the user to
 * — a Stripe Connect return/refresh URL, a checkout success/cancel URL.
 *
 * `z.string().url()` is not enough for these, and the difference is not
 * academic. It accepts any well-formed URL, including the origins a Capacitor
 * WebView reports when it serves bundled assets: `capacitor://localhost` (iOS)
 * and `ionic://localhost`. Those pass the contract, pass the derived server
 * schema, and are rejected by Stripe with a context-free `Not a valid URL`,
 * which surfaces to the user as a 500 and "sorry, try again".
 *
 * That shipped. `POST /integrations/stripe/account-link` returned 201 for every
 * desktop browser and 500 for every iPhone and iPad, across multiple orgs, for
 * days — the aggregate error rate looked survivable and no message named the
 * origin as the cause. Card setup was simply impossible in the native app.
 *
 * The scheme is the thing worth checking, because the scheme is what differs:
 * an outbound redirect target must be reachable by a browser anywhere, not just
 * by the device that generated it. `http` is allowed for loopback so local
 * development and tunnels keep working.
 *
 * Callers on the client should build these with `webAppUrl()` from
 * `apps/app/src/lib/web-app-origin.ts`, which resolves the app's PUBLIC origin
 * rather than the WebView's.
 */
export const externalRedirectUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      if (parsed.protocol === 'https:') return true;
      return (
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      );
    },
    {
      message:
        'Must be an https:// URL the payment provider can redirect back to (http:// is allowed only for localhost). A Capacitor WebView origin such as capacitor://localhost is not reachable from outside the device — send the public app origin instead.',
    }
  );
