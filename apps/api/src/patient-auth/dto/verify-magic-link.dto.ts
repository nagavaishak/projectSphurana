import { verifyMagicLinkSchema } from '@borradh-workspace/features/patient-auth';
import { createZodDto } from 'nestjs-zod';

export class VerifyMagicLinkDto extends createZodDto(verifyMagicLinkSchema) {}
