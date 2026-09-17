import { db } from '@borradh-workspace/database';
import { getPlanAssistantLimits } from '@borradh-workspace/features/assistant';
import { getSubscription } from '@borradh-workspace/features/billing';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

/**
 * Plan-tier gate for Claire (the assistant).
 *
 * Was `WhatsappLinkController.assertClaireAccess`, awaited as the first line of
 * all four of its handlers. Policy is a Guard's job (Gate 5).
 *
 * The rule mirrors `AssistantChatController`: an org with no subscription row
 * is treated as `free`, and a plan without assistant access gets a 403 whose
 * BODY is `{ error, code: 'NO_ACCESS' }` — the frontend switches on that code,
 * so the shape is contract, not decoration.
 */
@Injectable()
export class ClaireAccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.activeOrganizationId as string;

    const subResult = await getSubscription(db, { organizationId });
    const planId = subResult.success ? subResult.data.planId : 'free';

    if (!getPlanAssistantLimits(planId).hasAssistantAccess) {
      throw new ForbiddenException({
        error: 'Assistant not available on your plan',
        code: 'NO_ACCESS',
      });
    }
    return true;
  }
}
