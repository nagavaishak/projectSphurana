import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';
import { productMeasureUnitValues } from '../types';

/**
 * The create/edit-product form, declared ONCE.
 *
 * Its VALUES ARE the `ProductWriteIntent` that `buildProductWritePayload`
 * consumes — the raw form shape (money as typed strings, quantities as strings,
 * toggles as booleans), not the wire body. Every derivation to the wire
 * (`'10.00'` → `1000` cents, `'5'` → `5`, commission gated on retail) stays in
 * the builder, which is why so many fields below are marked `derived`.
 *
 * `markupRaw` is deliberately ABSENT: markup is presentational, computed from
 * supply and retail and never persisted. Keeping it out of the declaration is
 * what makes "the form's values are the intent" true rather than nearly true.
 *
 * `images` is `control: 'custom'` — the uploader is a dropzone in the editor's
 * aside, which a generic driver cannot operate; the contract spec asserts it is
 * on screen instead. The brand / category / supplier pickers ARE generic
 * comboboxes as far as the harness is concerned: it opens them by their label
 * and picks the option by its visible name, exactly as a user does.
 */
export const createProductForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Argan oil shampoo',
    },
    description: {
      schema: z.string(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: 'Sulphate-free cleansing shampoo',
    },
    brandId: {
      schema: z.string().nullable(),
      label: 'Brand',
      control: 'combobox',
      default: null,
      sample: 'brand_1',
      sampleLabel: 'Olaplex',
    },
    measureUnit: {
      schema: z.enum(productMeasureUnitValues),
      label: 'Measure',
      control: 'select',
      default: 'whole',
      sample: 'ml',
      sampleLabel: 'Millilitres',
    },
    measureAmount: {
      schema: z.string(),
      label: 'Amount',
      control: 'number',
      default: '',
      sample: '250',
      derived: true,
    },
    barcode: {
      schema: z.string(),
      label: 'Barcode',
      control: 'text',
      default: '',
      sample: 'BAR123',
    },
    categoryId: {
      schema: z.string().nullable(),
      label: 'Category',
      control: 'combobox',
      default: null,
      sample: 'cat_1',
      sampleLabel: 'Haircare',
    },
    supplyRaw: {
      schema: z.string(),
      label: 'Supply price',
      control: 'text',
      default: '',
      sample: '10.00',
      derived: true,
    },
    // Declared BEFORE the retail fields it reveals — the harness fills in
    // declaration order, and a hidden control is an unreachable one.
    retailEnabled: {
      schema: z.boolean(),
      label: 'Enable retail sales',
      control: 'switch',
      default: false,
      sample: true,
    },
    // A CLASS, not a preference. The DB forbids a medication being sold at
    // all (product_medication_never_sold), so this is declared BEFORE the
    // retail switch it disables.
    isMedication: {
      schema: z.boolean(),
      label: 'Medication — consumed in treatment, never sold',
      control: 'switch',
      default: false,
      sample: false,
    },
    // Only reachable once retail is on — the DB enforces the same thing via
    // product_online_implies_retail.
    onlineEnabled: {
      schema: z.boolean(),
      label: 'Sell on the online store',
      control: 'switch',
      default: false,
      sample: false,
    },
    shippable: {
      schema: z.boolean(),
      label: 'Can be posted',
      control: 'switch',
      default: true,
      sample: true,
    },
    retailRaw: {
      schema: z.string(),
      label: 'Retail price',
      control: 'text',
      default: '',
      sample: '25.00',
      derived: true,
    },
    teamMemberCommissionEnabled: {
      schema: z.boolean(),
      label: 'Team member commission',
      control: 'switch',
      default: false,
      sample: true,
    },
    /** Empty = use the connected Stripe account's preset product tax code. */
    taxCode: {
      schema: z.string(),
      label: 'Tax code',
      control: 'custom',
      default: '',
      sample: '',
      // The payload builder converts the form's empty string to null.
      derived: true,
    },
    skus: {
      schema: z.array(z.string()),
      label: 'Add SKU',
      control: 'tags',
      default: [],
      sample: ['SHAMPOO-001'],
    },
    supplierId: {
      schema: z.string().nullable(),
      label: 'Supplier',
      control: 'combobox',
      default: null,
      sample: 'sup_1',
      sampleLabel: 'Acme Supplies',
    },
    images: {
      schema: z.array(z.string()),
      label: 'Pictures',
      control: 'custom',
      default: [],
      sample: [],
      derived: true,
    },
    // Stock lives in the editor's last tab; again, the toggle that reveals the
    // rest is declared first.
    trackStock: {
      schema: z.boolean(),
      label: 'Track stock',
      control: 'switch',
      default: false,
      sample: true,
    },
    lowStockLevel: {
      schema: z.string(),
      label: 'Low stock level',
      control: 'number',
      default: '',
      sample: '5',
      derived: true,
    },
    reorderQuantity: {
      schema: z.string(),
      label: 'Reorder quantity',
      control: 'number',
      default: '',
      sample: '20',
      derived: true,
    },
    lowStockNotify: {
      schema: z.boolean(),
      label: 'Low-stock notifications',
      control: 'switch',
      default: false,
      sample: true,
    },
  },
});

export type CreateProductFormValues = InferFormValues<typeof createProductForm>;
