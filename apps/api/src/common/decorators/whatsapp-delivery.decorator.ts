import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface WhatsappDeliveryTag {
  conversationId: string;
}

/**
 * Extract the Claire-on-WhatsApp delivery tag from `body.deliverTo`.
 *
 * Renders and re-renders started from a WhatsApp conversation have no client
 * to poll for completion, so the job is tagged with the conversation to deliver
 * into. Only the `whatsapp` channel is honoured; web callers send nothing and
 * get `undefined`.
 *
 * This is request shaping, which is a param decorator's job (Gate 5) — it was
 * an inline `const whatsappDelivery = …` at the top of two handlers.
 */
export const WhatsappDelivery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WhatsappDeliveryTag | undefined => {
    const body = ctx.switchToHttp().getRequest<{
      body?: { deliverTo?: { channel?: string; conversationId?: string } };
    }>().body;

    const deliverTo = body?.deliverTo;
    return deliverTo?.channel === 'whatsapp' &&
      typeof deliverTo.conversationId === 'string' &&
      deliverTo.conversationId.length > 0
      ? { conversationId: deliverTo.conversationId }
      : undefined;
  }
);
