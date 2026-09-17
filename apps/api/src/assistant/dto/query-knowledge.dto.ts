import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const queryKnowledgeSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(50).optional(),
});

export class QueryKnowledgeDto extends createZodDto(queryKnowledgeSchema) {}
