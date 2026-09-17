import { createVoiceScriptRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST voice-scripts`. Previously an inline hand-copy (to dodge `.omit()`
 * type-depth issues); now the canonical wire contract, which already excludes
 * the session-injected `organizationId`.
 */
export class CreateVoiceScriptDto extends createZodDto(
  createVoiceScriptRequestSchema
) {}
