import { z } from 'zod';

/**
 * `z.number()` on these two was a live 400 in production. `main.ts` registers
 * nestjs-zod's `ZodValidationPipe` globally and this schema backs a whole-object
 * `@Query() dto` binding, so `GET /assistant/usage/history?days=7` handed the
 * STRING "7" to a number schema and was rejected at the boundary. Only the
 * default path (params omitted) ever worked.
 *
 * The integration harness could not show this: it registered only the stock
 * class-validator pipe, which validates nothing on a `createZodDto`, so the
 * string reached the service and was re-parsed there.
 */
export const getUsageHistorySchema = z.object({
  organizationId: z.string().min(1),
  days: z.coerce.number().int().positive().max(90).default(30),
  monthlyMonths: z.coerce.number().int().positive().max(24).default(6),
});

export type GetUsageHistoryInput = z.input<typeof getUsageHistorySchema>;
export type GetUsageHistoryParsed = z.output<typeof getUsageHistorySchema>;
