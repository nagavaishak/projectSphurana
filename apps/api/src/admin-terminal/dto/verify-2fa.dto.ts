import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const verify2faSchema = z.object({
  code: z.string().length(6, 'TOTP code must be 6 digits'),
});

export class Verify2faDto extends createZodDto(verify2faSchema) {}
