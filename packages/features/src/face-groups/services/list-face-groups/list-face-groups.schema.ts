import { z } from 'zod';

export const listFaceGroupsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

export type ListFaceGroupsInput = z.infer<typeof listFaceGroupsSchema>;
