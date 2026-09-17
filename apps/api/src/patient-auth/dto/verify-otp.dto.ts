import { verifyOtpSchema } from '@borradh-workspace/features/patient-auth';
import { createZodDto } from 'nestjs-zod';

export class VerifyOtpDto extends createZodDto(verifyOtpSchema) {}
