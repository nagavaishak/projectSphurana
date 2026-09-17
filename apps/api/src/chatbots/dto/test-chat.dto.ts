import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const testChatBodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            id: z.string().optional(),
            role: z.enum(['user', 'assistant', 'system']),
            parts: z.array(z.object({ type: z.string() }).passthrough()),
          })
          .passthrough()
      )
      .min(1, 'At least one message is required'),
    voiceCloning: z.boolean().optional(),
  })
  .passthrough();

export class TestChatDto extends createZodDto(testChatBodySchema) {}
