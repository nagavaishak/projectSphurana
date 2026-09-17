import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The create/edit-supplier form, declared ONCE.
 *
 * Schema, defaults and the labels the dialog renders all derive from this — so
 * `description` cannot be dropped from the JSX while the intent and the payload
 * builder keep mapping it.
 *
 * NOTE the second "surface" of `POST /suppliers` — the inline `Create "…"` row
 * on the stock-order / product supplier picker — is a NAME-ONLY quick-create by
 * design: it has no description control at all, and the builder coalesces the
 * missing description to `null`. That is a deliberately reduced affordance, not
 * a dropped field, and the harness has no way to express it (one form, one
 * expected body, all surfaces). See `create-supplier.contract.test.tsx`.
 */
export const createSupplierForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Acme Supplies',
    },
    description: {
      schema: z.string(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: 'Trusted wholesale partner',
    },
  },
});

export const createSupplierSchema = createSupplierForm.schema;
export const createSupplierDefaultValues = createSupplierForm.defaults;
export const createSupplierFields = createSupplierForm.fields;

export type CreateSupplierFormValues = InferFormValues<
  typeof createSupplierForm
>;
