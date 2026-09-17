import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';
import type { StockOrderFeeType } from '../types';

const itemRowSchema = z.object({
  // `.min(1)` on purpose: an empty product id is what a blank line holds, and a
  // stock order made only of blank lines is the one body the endpoint refuses.
  productId: z.string().min(1),
  quantity: z.string(),
  costRaw: z.string(),
});

const feeRowSchema = z.object({
  name: z.string().min(1),
  type: z.custom<StockOrderFeeType>(),
  valueRaw: z.string(),
});

/**
 * Today at local midnight — the harness's sample date.
 *
 * A fixed calendar date would drift out of the month the picker opens on, and
 * a spec that has to page the calendar to reach its sample is a spec that
 * breaks on the 1st of the month. Today is always on screen.
 */
const todayAtMidnight = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * The create-stock-order form, declared ONCE.
 *
 * Its VALUES ARE the `CreateStockOrderIntent` the payload builder takes — same
 * keys, same raw shapes — so the editor hands its state straight to the builder
 * and there is no intermediate mapping to drift.
 *
 * Four of the six controls are bespoke (a combobox with inline-create, a day
 * picker, and the two repeating-row editors), so they declare
 * `control: 'custom'` and the contract spec drives them explicitly. That is the
 * escape hatch working as intended: the harness still refuses to let a field be
 * skipped, it just cannot guess how to fill this one.
 */
export const createStockOrderForm = defineForm({
  fields: {
    supplierId: {
      schema: z.string().nullable(),
      label: 'Supplier',
      control: 'custom',
      default: null,
      sample: 'sup_1',
    },
    locationId: {
      schema: z.string().nullable(),
      label: 'Deliver to',
      control: 'select',
      default: null,
      sample: 'loc_1',
      sampleLabel: 'Bray Studio',
    },
    expectedByDate: {
      schema: z.date().nullable(),
      label: 'Expected by',
      control: 'custom',
      default: null,
      sample: todayAtMidnight(),
      derived: true,
    },
    notes: {
      schema: z.string(),
      label: 'Notes',
      control: 'textarea',
      default: '',
      sample: 'Rush order',
    },
    itemRows: {
      schema: z.array(itemRowSchema).min(1),
      label: 'Products',
      control: 'custom',
      default: [{ productId: '', quantity: '1', costRaw: '' }],
      sample: [{ productId: 'prod_1', quantity: '2', costRaw: '12.50' }],
      derived: true,
    },
    feeRows: {
      schema: z.array(feeRowSchema),
      label: 'Fees',
      control: 'custom',
      default: [],
      sample: [{ name: 'Shipping', type: 'currency', valueRaw: '4.00' }],
      derived: true,
    },
  },
});

export type CreateStockOrderFormValues = InferFormValues<
  typeof createStockOrderForm
>;
