import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The create/edit product-category form, declared ONCE. A category is a name and
 * nothing else, which is why BOTH of its surfaces — the full
 * `ProductCategoryDialog` and the inline `Create "…"` row on the product form's
 * category picker — can produce the whole body, and property 4 is live for it.
 */
export const createProductCategoryForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required'),
      label: 'Name',
      // Two surfaces, two genuinely different controls: the dialog's labelled
      // input, and the picker's search box (what the user types the new name
      // into). The contract drives each one through its own real control.
      control: 'custom',
      default: '',
      sample: 'Shampoo',
    },
  },
});

export const createProductCategorySchema = createProductCategoryForm.schema;
export const createProductCategoryDefaultValues =
  createProductCategoryForm.defaults;
export const createProductCategoryFields = createProductCategoryForm.fields;

export type CreateProductCategoryFormValues = InferFormValues<
  typeof createProductCategoryForm
>;
