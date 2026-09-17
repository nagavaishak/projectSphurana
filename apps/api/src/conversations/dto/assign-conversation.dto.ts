import { assignConversationRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST conversations/:id/assign`. */
export class AssignConversationDto extends createZodDto(
  assignConversationRequestSchema
) {}
