import { applyModesSchema } from '@borradh-workspace/features/website-analysis';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The analysis itself is NEVER sent by the client — only the `jobId` of a scan
 * the server already ran. The server re-reads that job (tenant-scoped) and uses
 * its own copy of the result, so a request cannot post an arbitrary catalog
 * into an organization.
 */
const previewAnalysisSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
});

export class PreviewAnalysisDto extends createZodDto(previewAnalysisSchema) {}

/** `POST /website-analysis/apply` body — a scan plus the per-section choices. */
const applyAnalysisSchema = previewAnalysisSchema.extend({
  modes: applyModesSchema.partial().optional(),
  /**
   * Plan-row keys the owner un-ticked in the review step. Absent = apply the
   * whole plan, which is what the onboarding bootstrap does.
   */
  deselected: z.array(z.string().min(1)).max(5000).optional(),
});

export class ApplyAnalysisDto extends createZodDto(applyAnalysisSchema) {}
