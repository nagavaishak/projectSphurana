import { logError } from '@borradh-workspace/observability';
import jwt from 'jsonwebtoken';

/**
 * Generate an Intercom identity verification JWT for the given user.
 * Returns undefined if the secret is not configured or signing fails.
 */
export function generateIntercomJwt(
  secret: string | undefined,
  user: { id: string; email: string }
): string | undefined {
  if (!secret) return undefined;

  try {
    return jwt.sign({ user_id: user.id, email: user.email }, secret, {
      expiresIn: '1h',
    });
  } catch (error) {
    logError('auth.generateIntercomJwt', error, {
      feature: 'auth',
      extra: { userId: user.id },
    });
    return undefined;
  }
}
