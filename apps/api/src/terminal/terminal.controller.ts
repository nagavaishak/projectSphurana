import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, ConnectedStripeAccount } from '../common';

/**
 * Stripe Terminal endpoints (contract §7.B). Provides the connection token the
 * Tap to Pay SDK needs on the connected account.
 *
 * Resolving (and requiring) the org's connected account is `@ConnectedStripeAccount`
 * — see `apps/api/src/common/decorators/connected-stripe-account.decorator.ts`.
 */
@Controller('terminal')
@UseGuards(AuthGuard)
export class TerminalController {
  private readonly logger = new Logger(TerminalController.name);

  @Post('connection-token')
  async connectionToken(@ConnectedStripeAccount() connectedAccountId: string) {
    try {
      const stripeConnect = getStripeConnectService();
      return await stripeConnect.createTerminalConnectionToken(
        connectedAccountId
      );
    } catch (error) {
      this.logger.error('Failed to create Terminal connection token', error);
      throw new HttpException(
        'Failed to create Terminal connection token',
        HttpStatus.BAD_GATEWAY
      );
    }
  }
}
