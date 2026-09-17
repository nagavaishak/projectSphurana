import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `PATCH microsites/:id/pages/:pageId/blocks/:blockId` — the inspector edit and
 * the canvas drag, which run the agent's own `update_block` / `move_block`.
 *
 * `propsPatch` is a PATCH for the same reason the tool's is: the inspector
 * edits one field at a time and must not re-send (and risk dropping) the rest.
 */
const updateMicrositeBlockSchema = z
  .object({
    propsPatch: z.record(z.string(), z.unknown()).optional(),
    variant: z.string().min(1).optional(),
    toIndex: z.number().int().min(0).optional(),
  })
  .refine(
    (value) =>
      value.propsPatch !== undefined ||
      value.variant !== undefined ||
      value.toIndex !== undefined,
    { message: 'Provide propsPatch, variant or toIndex' }
  );

export class UpdateMicrositeBlockDto extends createZodDto(
  updateMicrositeBlockSchema
) {}
