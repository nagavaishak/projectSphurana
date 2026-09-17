import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The face-group rename form, declared ONCE.
 *
 * `PUT face-groups/:id` is a PARTIAL update: each surface sends only the keys it
 * touched. The one field a user actually TYPES — and the only one both surfaces
 * (the batch review card and the onboarding before/after row) can produce — is
 * the client name, so that is the form.
 *
 * The row's service picker fires its own separate `PUT` carrying only
 * `serviceId`, and `isExcluded` has NO control on any surface at all (see the
 * contract spec's header for both). Neither is part of this form.
 */
export const updateFaceGroupForm = defineForm({
  fields: {
    clientName: {
      schema: z.string().min(1, 'Client name is required'),
      // Both surfaces render a bare `<Input placeholder="Client name">`, so the
      // label is the input's accessible name rather than a visible <label>.
      label: 'Client name',
      control: 'text',
      default: '',
      sample: 'Alice Smith',
    },
  },
});

export const updateFaceGroupSchema = updateFaceGroupForm.schema;
export const updateFaceGroupDefaultValues = updateFaceGroupForm.defaults;
export const updateFaceGroupFields = updateFaceGroupForm.fields;

export type UpdateFaceGroupFormValues = InferFormValues<
  typeof updateFaceGroupForm
>;
