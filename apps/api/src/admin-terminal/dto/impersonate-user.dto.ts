import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const impersonateUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export class ImpersonateUserDto extends createZodDto(impersonateUserSchema) {}
