import { saveContentRuleSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /assistant/content-rules. `organizationId` comes from the
 * session; the client sends the rule text and, optionally, the batch it was
 * learned from.
 */
export class SaveContentRuleDto extends createZodDto(
  saveContentRuleSchema.omit({ organizationId: true })
) {}
