import { z } from 'zod';

export const exportSnapshotsSchema = z.object({
  date: z.date(),
});

export type ExportSnapshotsInput = z.infer<typeof exportSnapshotsSchema>;
