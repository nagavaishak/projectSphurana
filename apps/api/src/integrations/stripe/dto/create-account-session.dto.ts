import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createAccountSessionDtoSchema = z.object({
  // Optional narrowing of enabled embedded components
  components: z.array(z.string().min(1)).optional(),
});

export class CreateAccountSessionDto extends createZodDto(
  createAccountSessionDtoSchema
) {}
