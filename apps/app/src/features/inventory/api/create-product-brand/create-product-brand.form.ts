import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The create/edit product-brand form, declared ONCE. Schema, defaults and the
 * labels `ProductBrandDialog` renders all derive from this.
 *
 * The other "surface" of `POST /product-brands` — the inline `Create "…"` row on
 * the product form's brand picker — is a NAME-ONLY quick-create by design (no
 * description control; the builder coalesces to `null`). See
 * `create-product-brand.contract.test.tsx` for why it cannot be a harness
 * surface.
 */
export const createProductBrandForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Kerastase',
    },
    description: {
      schema: z.string(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: 'Premium haircare range',
    },
  },
});

export const createProductBrandSchema = createProductBrandForm.schema;
export const createProductBrandDefaultValues = createProductBrandForm.defaults;
export const createProductBrandFields = createProductBrandForm.fields;

export type CreateProductBrandFormValues = InferFormValues<
  typeof createProductBrandForm
>;
