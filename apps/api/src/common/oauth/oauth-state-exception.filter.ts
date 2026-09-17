import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { OAuthStateError } from './oauth-callback.js';
import { webOrigin } from './oauth-redirect.interceptor.js';

/**
 * Renders a failed state verification as the friendly redirect these callbacks
 * already produced for a malformed state, rather than as a JSON 403.
 *
 * PRESERVING THE OLD USER-VISIBLE BEHAVIOUR IS THE POINT. Before the signature
 * existed, an unparseable state redirected here with "Connection expired.
 * Please try again."; a FORGED state was accepted and acted upon. Now both land
 * on this same message. A legitimate user whose flow genuinely expired sees
 * exactly what they saw before, and an attacker learns nothing from the
 * difference — the response is byte-identical either way.
 */
@Catch(OAuthStateError)
export class OAuthStateExceptionFilter implements ExceptionFilter {
  catch(exception: OAuthStateError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const params = new URLSearchParams({
      integration: exception.label,
      status: 'error',
      message: 'Connection expired. Please try again.',
    });
    res.redirect(`${webOrigin()}/dashboard/integrations?${params.toString()}`);
  }
}
