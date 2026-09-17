import { apiEnv } from '@borradh-workspace/env/api';
import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * CSRF protection via Origin header validation.
 *
 * For state-changing requests (POST, PUT, DELETE, PATCH), validates that the
 * Origin header matches allowed origins. This is defense-in-depth on top of
 * SameSite=Lax cookies and CORS.
 *
 * Skips:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - /better-auth/* routes (Better Auth handles its own CSRF)
 * - /webhooks/* and any path ending in /webhook (use their own signature verification)
 * - /testing/* routes (E2E test helpers)
 * - Non-production when no Origin is present (allows curl, Postman)
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly allowedOrigins: string[];

  // Vercel preview deployments — dynamic hostname per push. Anchored to this
  // app's deployments under our team. MUST be kept in sync with
  // `vercelPreviewPattern` in apps/api/src/main.ts (CORS) so legitimate
  // preview traffic that passes CORS isn't then rejected by CSRF.
  private readonly vercelPreviewPattern =
    /^https:\/\/borradh(-(web|app|marketing))?-[a-z0-9-]+-borradh-technologies\.vercel\.app$/;

  // Dev/staging environments on borradh-dev.com — kept in sync with main.ts
  private readonly devStagingPattern =
    /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.borradh-dev\.com$/;

  constructor() {
    // Mirror the CORS allowlist in apps/api/src/main.ts so any origin allowed
    // to make a credentialed request is also accepted by CSRF validation.
    this.allowedOrigins = [
      'http://localhost:3001', // Web app
      'http://localhost:8081', // Mobile (Expo)
      'http://localhost:5173', // Vite dev (apps/app)
      'http://localhost:4173', // Vite preview (apps/app)
      'capacitor://localhost', // Capacitor iOS webview (apps/app native build)
      'https://localhost', // Capacitor iOS dev https
      'https://app.borradh.io', // Production apps/app (Vite SPA)
      'https://borradh.io', // Production apps/marketing
      'https://www.borradh.io', // Production marketing (apex redirect target)
      apiEnv.WEB_URL,
      apiEnv.MOBILE_URL,
    ].filter(Boolean) as string[];
  }

  use(req: Request, _res: Response, next: NextFunction) {
    // Skip safe methods
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    // Skip routes that handle their own auth/signature verification
    const path = req.path;
    if (
      path.startsWith('/better-auth') ||
      path.startsWith('/webhooks') ||
      path.endsWith('/webhook') ||
      path.startsWith('/testing') ||
      path.startsWith('/public')
    ) {
      return next();
    }

    // CSRF only applies to ambient cookie credentials. Requests authenticated
    // with a Bearer token or API key (the Capacitor mobile app, server-to-server
    // callers, and the v1/* API) are not forgeable cross-site — a malicious page
    // cannot set these headers on a cross-origin request — so the Origin check
    // does not apply to them. Without this, the mobile app (which sends no Origin
    // in native fetches) would be rejected once CSRF is enforced.
    if (req.get('authorization') || req.get('x-api-key')) {
      return next();
    }

    const origin = req.get('Origin');

    // No origin header
    if (!origin) {
      // In production, reject — browsers always send Origin on cross-origin POST
      // Server-to-server calls should use API keys (v1/* routes), not session cookies
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException('Origin header required');
      }
      // In development, allow (curl, Postman, etc.)
      return next();
    }

    // Check against allowed origins
    if (this.allowedOrigins.includes(origin)) {
      return next();
    }

    // Allow this app's vercel preview deployments (matches CORS in main.ts)
    if (this.vercelPreviewPattern.test(origin)) {
      return next();
    }

    // Allow dev/staging environments on borradh-dev.com (matches CORS in main.ts)
    if (this.devStagingPattern.test(origin)) {
      return next();
    }

    throw new ForbiddenException('Origin not allowed');
  }
}
