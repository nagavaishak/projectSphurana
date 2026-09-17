import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * The session must be on an organization.
 *
 * This is the single most-repeated block in the API — a six-line
 * `if (!organizationId) throw 400` opening literally every handler of a
 * controller. `AssistantController` had it fourteen times out of fourteen
 * routes, which is the definition of a class-level concern.
 *
 * Applied at the CLASS level it also closes the gap the inline form leaves:
 * the fifteenth route someone adds is covered automatically, instead of
 * dereferencing an `organizationId` its type says is a `string` and its runtime
 * value is `undefined`.
 *
 * The exception is constructed exactly as the inline checks did — same message,
 * same 400 — so a client that string-matches the body still matches.
 *
 * ORDERING NOTE: a Guard runs BEFORE the handler's `ValidationPipe`. For a
 * request that is BOTH org-less AND carries an invalid body, the response is
 * now this 400 rather than the validation 400. Same status, different message;
 * no route returns anything other than 400 for either condition.
 */
@Injectable()
export class ActiveOrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.activeOrganizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return true;
  }
}
