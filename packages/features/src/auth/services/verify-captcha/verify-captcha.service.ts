import { apiEnv } from '@borradh-workspace/env/api';
import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger } from '@borradh-workspace/observability';

const logger = createLogger('VerifyCaptcha');

/**
 * Verify a Cloudflare Turnstile CAPTCHA token.
 * Returns true if verification passes or if Turnstile is not configured (dev mode).
 */
export async function verifyCaptcha(token: string): Promise<boolean> {
  const secretKey = apiEnv.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Only skip in development — log a warning so misconfigured production is visible
    if (apiEnv.NODE_ENV === 'production') {
      logger.error(
        'TURNSTILE_SECRET_KEY not configured in production — rejecting CAPTCHA'
      );
      return false;
    }
    return true;
  }

  try {
    const response = await fetchWithRetry(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: secretKey, response: token }),
      }
    );

    const data = (await response.json()) as { success: boolean };
    return data.success === true;
  } catch (error) {
    logger.error('Turnstile verification request failed', { error });
    // Fail closed — reject sign-ups when Cloudflare is unreachable
    return false;
  }
}
