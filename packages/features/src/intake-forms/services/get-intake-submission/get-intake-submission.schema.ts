import { z } from 'zod';
export const getIntakeSubmissionSchema = z.object({
  organizationSlug: z.string().min(1),
  token: z.string().min(1),
});
export type GetIntakeSubmissionInput = z.infer<
  typeof getIntakeSubmissionSchema
>;

export interface PublicIntakeView {
  submissionId: string;
  formName: string;
  formDescription: string | null;
  fields: import('@borradh-workspace/database').IntakeFormField[];
  status: string;
  /**
   * Prior answers when revisiting a completed form (read-only review).
   * `form_submission.answers` is nullable; an unanswered form reads as `{}`.
   */
  answers: Record<string, import('@borradh-workspace/database').IntakeAnswer>;
  organization: { name: string; slug: string; logo: string | null };
}
