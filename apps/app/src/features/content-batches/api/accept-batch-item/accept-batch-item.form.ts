import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The accept-and-schedule form behind `POST content-batches/items/:id/accept`,
 * declared ONCE.
 *
 * Accepting a batch item also SCHEDULES it, so the (optionally edited) caption,
 * the target pages and the post time ride along on the accept. The
 * {@link BatchReviewDialog} is the surface that carries all three; its labels are
 * rendered from here, so a control deleted from the JSX cannot leave the field
 * behind in the intent and the payload builder.
 *
 * The onboarding `ContentApprovalSlide` accepts with the CAPTION ONLY —
 * `scheduledAt` / `targetPageIds` are deliberately omitted so the server keeps
 * the planner-seeded values (omitted ≠ null: null means "post as a draft"). It
 * is therefore a genuinely reduced surface sending a genuinely different body,
 * which the harness cannot model. See `accept-batch-item.contract.test.tsx`.
 */
export const acceptBatchItemForm = defineForm({
  fields: {
    caption: {
      schema: z.string(),
      label: 'Caption',
      control: 'textarea',
      default: '',
      sample: 'Fresh caption',
    },
    targetPageIds: {
      // Bespoke pill toggles, one per connected page — driven by a `fills` override.
      schema: z.array(z.string()),
      label: 'Post to',
      control: 'custom',
      default: [],
      sample: ['page-a'],
    },
    scheduledAt: {
      // A day picker + a time input. What the user picks is a local date/time;
      // what reaches the wire is an ISO string (or `null` for "save as draft"),
      // hence `derived`.
      schema: z.string().nullable(),
      label: 'When to post',
      control: 'custom',
      default: null,
      sample: null,
      derived: true,
    },
  },
});

export const acceptBatchItemSchema = acceptBatchItemForm.schema;
export const acceptBatchItemDefaultValues = acceptBatchItemForm.defaults;
export const acceptBatchItemFields = acceptBatchItemForm.fields;

export type AcceptBatchItemFormValues = InferFormValues<
  typeof acceptBatchItemForm
>;
