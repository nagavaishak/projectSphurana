import { z } from 'zod';
export const issueIntakeSubmissionSchema = z.object({
  organizationId: z.string().min(1),
  intakeFormId: z.string().min(1),
  leadId: z.string().min(1),
  appointmentId: z.string().optional(),
});
export type IssueIntakeSubmissionInput = z.infer<
  typeof issueIntakeSubmissionSchema
>;
