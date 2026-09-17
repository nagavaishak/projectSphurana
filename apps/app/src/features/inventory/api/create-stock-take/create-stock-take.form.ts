import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The start-a-stocktake form, declared ONCE.
 *
 * Schema, defaults and the labels the editor renders all derive from this, so
 * a control cannot be dropped from the editor while the intent and the payload
 * builder keep mapping it.
 *
 * `locationId` is the only required field: stock is per-location, and
 * completing a count writes the counted quantities into that location's stock.
 * Name and description are free notes, blank by default and coalesced to `null`
 * by the builder — "no name" must reach the wire as absence, not as `''`.
 */
export const createStockTakeForm = defineForm({
  fields: {
    locationId: {
      schema: z.string().min(1, 'Select a location'),
      label: 'Location',
      control: 'select',
      default: '',
      sample: 'loc_1',
      sampleLabel: 'Bray Studio',
    },
    name: {
      schema: z.string(),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Monthly count',
    },
    description: {
      schema: z.string(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: 'End-of-month reconciliation',
    },
  },
});

export type CreateStockTakeFormValues = InferFormValues<
  typeof createStockTakeForm
>;
