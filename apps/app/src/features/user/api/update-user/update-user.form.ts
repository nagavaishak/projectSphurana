import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The update-user profile form, declared ONCE.
 *
 * `PUT users/:id` is reached from two surfaces — the settings/index profile card
 * and the user-settings profile tab — and both now build their form from this
 * declaration and hand the intent to the one {@link buildUpdateUserPayload}.
 *
 * `name` is the only user-editable field. The email input both surfaces render
 * is DISABLED by design ("your email address cannot be changed") and is never
 * submitted, so it is not a form field at all — it displays the session's email.
 * `image` exists on the PATCH intent for the builder's benefit but has no
 * editor anywhere; neither surface sends it.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const updateUserForm = defineForm({
  fields: {
    name: {
      // Matches the wire body's rule, so the form rejects what the API would.
      schema: z.string().min(2, 'Name must be at least 2 characters'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Dana Scully',
    },
  },
});

export const updateUserFormSchema = updateUserForm.schema;
export const updateUserFormDefaultValues = updateUserForm.defaults;
export const updateUserFormFields = updateUserForm.fields;

export type UpdateUserFormValues = InferFormValues<typeof updateUserForm>;
