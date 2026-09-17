import { createAssetRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST assets`. `organizationId` / `uploadedById` come from the session. */
export class CreateAssetDto extends createZodDto(createAssetRequestSchema) {}
