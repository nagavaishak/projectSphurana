import { createVideoRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /videos` body, sourced from the canonical wire contract.
 *
 * The endpoint accepts partial input (W3 one-prompt creation):
 *   - Minimum: `{ format }` or `{ templateId }` → the service synthesises the
 *     full draftConfig from org defaults + template + optional service.
 *   - Maximum: legacy wizard payload with a complete `draftConfig`.
 *
 * The service introspects the payload to decide which path to take.
 */
export class CreateVideoDto extends createZodDto(createVideoRequestSchema) {}
