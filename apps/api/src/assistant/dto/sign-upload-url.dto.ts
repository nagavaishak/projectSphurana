import { signUploadUrlSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Body of `POST /assistant/uploads/sign`. Server fills `organizationId` +
 * `userId` from the auth context, so the client only sends `conversationId`
 * and `mimeType`.
 */
export class SignUploadUrlDto extends createZodDto(
  signUploadUrlSchema.omit({ organizationId: true, userId: true })
) {}
