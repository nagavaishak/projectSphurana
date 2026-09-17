import { generateGraphicFromServiceRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Live `/graphics/generate` endpoint body. The controller stamps
 * `organizationId` from the session so it's absent from the wire contract.
 */
export class GenerateGraphicFromServiceDto extends createZodDto(
  generateGraphicFromServiceRequestSchema
) {}
