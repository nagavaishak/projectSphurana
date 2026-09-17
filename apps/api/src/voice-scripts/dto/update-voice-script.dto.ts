import { updateVoiceScriptRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT voice-scripts/:id` body, sourced from the canonical wire contract.
 *
 * This DTO used to be a hand-written copy that accepted `voiceProviderAgentId`,
 * a field `updateVoiceScript` never read — sending it did nothing. The contract
 * does not carry it; see the contract's doc comment.
 */
export class UpdateVoiceScriptDto extends createZodDto(
  updateVoiceScriptRequestSchema
) {}
