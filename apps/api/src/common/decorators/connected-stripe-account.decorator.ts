import { db } from '@borradh-workspace/database';
import { getStripeConnection } from '@borradh-workspace/features/integrations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  type ExecutionContext,
  HttpException,
  HttpStatus,
  createParamDecorator,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard.js';

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
};

/**
 * The active organization's Stripe Connect account id, or a 400.
 *
 * Was `TerminalController.requireActiveOrganization` +
 * `requireConnectedAccount`, run as the first two statements of the only
 * handler. Deriving a value from the request is a param decorator's job
 * (Gate 5) — the same seam as `@ActiveOrganization`.
 *
 * Failure modes preserved exactly, in the same order the controller checked
 * them:
 *   - no active organization on the session → 400 "No active organization
 *     selected";
 *   - the lookup itself errors             → the Result code's HTTP status;
 *   - no connection row, or an inactive one → 400 "Stripe is not connected for
 *     this organization".
 */
export const ConnectedStripeAccount = createParamDecorator(
  async (_data: unknown, ctx: ExecutionContext): Promise<string> => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.activeOrganizationId;

    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await getStripeConnection(db, { organizationId });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        STATUS_BY_CODE[result.error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!result.data || !result.data.isActive) {
      throw new HttpException(
        'Stripe is not connected for this organization',
        HttpStatus.BAD_REQUEST
      );
    }
    return result.data.stripeAccountId;
  }
);
