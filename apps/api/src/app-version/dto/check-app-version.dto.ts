import { checkAppVersionSchema } from '@borradh-workspace/features/app-version';
import { createZodDto } from 'nestjs-zod';

export class CheckAppVersionDto extends createZodDto(checkAppVersionSchema) {}
