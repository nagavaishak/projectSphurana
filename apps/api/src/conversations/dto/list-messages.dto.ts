import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export class ListMessagesDto extends createZodDto(listMessagesQuerySchema) {}
