import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const enableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export class EnableTwoFactorDto extends createZodDto(enableTwoFactorSchema) {}
