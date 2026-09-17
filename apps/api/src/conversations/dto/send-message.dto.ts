import { sendMessageRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST conversations/:id/messages`. The conversation is the route param and
 * the sending agent comes from the session, so `content` is the whole body.
 */
export class SendMessageDto extends createZodDto(sendMessageRequestSchema) {}
