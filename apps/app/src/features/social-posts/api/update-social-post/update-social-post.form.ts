import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The edit-social-post form, declared ONCE for every surface that edits a post:
 * the docked {@link SocialPostPanel} and the mobile post-detail screen.
 *
 * `date` + `time` fold into the wire's `scheduledAt`, so both are `derived` — the
 * contract's `expectedBody` spells the ISO instant out. The calendar drag-drop
 * path reaches the same builder from an already-ISO instant (there are no fields
 * to fill in a drag), and the spec pins the two conversions to the same value.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const updateSocialPostForm = defineForm({
  fields: {
    title: {
      schema: z.string().min(1, 'Title is required'),
      label: 'Title',
      control: 'text',
      default: '',
      sample: 'Rescheduled launch post',
    },
    caption: {
      schema: z.string().optional(),
      label: 'Caption',
      control: 'textarea',
      default: '',
      sample: 'A brand new caption',
    },
    /**
     * A calendar-popover button, not a text input, so the contract drives it with
     * a `fills.date` override. Seeded from the post's `scheduledAt` at mount.
     */
    date: {
      schema: z.string().min(1, 'Date is required'),
      label: 'Date',
      control: 'custom',
      default: '',
      sample: '',
      derived: true,
    },
    time: {
      schema: z.string().min(1, 'Time is required'),
      label: 'Time',
      control: 'time',
      default: '',
      sample: '14:30',
      derived: true,
    },
  },
});

export const updateSocialPostSchema = updateSocialPostForm.schema;
export const updateSocialPostDefaultValues = updateSocialPostForm.defaults;
export const updateSocialPostFields = updateSocialPostForm.fields;

export type UpdateSocialPostFormValues = InferFormValues<
  typeof updateSocialPostForm
>;
