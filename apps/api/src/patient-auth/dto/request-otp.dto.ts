import { requestOtpSchema } from '@borradh-workspace/features/patient-auth';
import { createZodDto } from 'nestjs-zod';

export class RequestOtpDto extends createZodDto(requestOtpSchema) {}
