import { marketPositionValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const setMarketPositionSchema = z.object({
  organizationId: z.string().min(1),
  marketPosition: z.enum(marketPositionValues),
});

export type SetMarketPositionInput = z.infer<typeof setMarketPositionSchema>;
