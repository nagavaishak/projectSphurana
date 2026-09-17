import {
  type FieldSpecMap,
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { countryCodeValues } from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The create-location form, declared ONCE.
 *
 * Field rules mirror `createLocationRequestBase` in
 * `@borradh-workspace/contracts` — the canonical wire contract the API DTO
 * validates against. The two are bound at the payload builder, which parses
 * this form's intent through that exact schema, so a field that drifts out of
 * range here fails at build time rather than as a 400 in front of the user.
 *
 * `latitude` / `longitude` are `exempt`: they are not typed, they arrive with a
 * place picked from the address search. The address search itself is NOT a
 * field — it is a convenience that writes into the address fields below it,
 * which stay visible and editable so a user can always see and correct what it
 * filled in.
 */
/**
 * The branch's OWN fields — everything that lives on the `organization_location`
 * row. Named separately because both write operations need exactly these, and a
 * label that drifted between them would move the control out from under one of
 * the two contracts.
 */
const RECORD_FIELDS = {
  name: {
    schema: z.string().max(100, 'Name too long'),
    label: 'Location name',
    control: 'text',
    default: '',
    sample: 'Bray Studio',
  },
  isPrimary: {
    schema: z.boolean(),
    label: 'Primary location',
    control: 'switch',
    default: false,
    sample: true,
  },
  addressLine1: {
    schema: z.string().min(1, 'Address is required').max(200),
    label: 'Address line 1',
    control: 'text',
    default: '',
    sample: '12 Quinsboro Road',
  },
  addressLine2: {
    schema: z.string().max(200),
    label: 'Address line 2',
    control: 'text',
    default: '',
    sample: 'Unit 3',
  },
  city: {
    schema: z.string().min(1, 'City is required').max(100),
    label: 'City',
    control: 'text',
    default: '',
    sample: 'Bray',
  },
  county: {
    schema: z.string().max(100),
    label: 'County',
    control: 'text',
    default: '',
    sample: 'Wicklow',
  },
  postalCode: {
    schema: z.string().max(20),
    label: 'Postal code',
    control: 'text',
    default: '',
    sample: 'A98 X264',
  },
  country: {
    schema: z.enum(countryCodeValues, { message: 'Invalid country code' }),
    label: 'Country',
    control: 'select',
    default: 'ie',
    sample: 'ie',
    sampleLabel: 'Ireland',
  },
} satisfies FieldSpecMap;

/**
 * Create-only. These do not belong to the location row at all — they become
 * join rows — and on an EXISTING branch they are written by
 * `PUT /organization-locations/:id/catalog` instead, which is why the update
 * form below does not carry them.
 */
const CATALOG_SEED_FIELDS = {
  // --- Catalogue seed -----------------------------------------------------
  // ADDITIVE ONLY. An unticked row does not mean "not available here": zero
  // join rows means "available at EVERY branch", so anything unrestricted is
  // already available at a new location. See
  // `locationCatalogSeedRequestSchema`. Every one of these defaults to empty,
  // which is the "copy nothing" default and costs no writes.
  copyFromLocationId: {
    schema: z.string().nullable(),
    label: 'Copy setup from',
    control: 'custom',
    default: null,
    sample: null,
    derived: true,
  },
  practitionerIds: {
    schema: z.array(z.string()),
    label: 'Team',
    control: 'custom',
    default: [],
    sample: [],
    derived: true,
  },
  serviceIds: {
    schema: z.array(z.string()),
    label: 'Services',
    control: 'custom',
    default: [],
    sample: [],
    derived: true,
  },
  productIds: {
    schema: z.array(z.string()),
    label: 'Products',
    control: 'custom',
    default: [],
    sample: [],
    derived: true,
  },
  membershipPlanIds: {
    schema: z.array(z.string()),
    label: 'Memberships',
    control: 'custom',
    default: [],
    sample: [],
    derived: true,
  },
  offerIds: {
    schema: z.array(z.string()),
    label: 'Promotions',
    control: 'custom',
    default: [],
    sample: [],
    derived: true,
  },
} satisfies FieldSpecMap;

/** Set by the address search, never typed — see each spec's `exempt` reason. */
const GEO_FIELDS = {
  latitude: {
    schema: z.number().nullable(),
    default: null,
    exempt:
      'Comes from the place picked in the address search, never typed. A hand-entered coordinate is a wrong coordinate.',
  },
  longitude: {
    schema: z.number().nullable(),
    default: null,
    exempt:
      'Comes from the place picked in the address search, never typed. A hand-entered coordinate is a wrong coordinate.',
  },
} satisfies FieldSpecMap;

export const createLocationForm = defineForm({
  fields: { ...RECORD_FIELDS, ...CATALOG_SEED_FIELDS, ...GEO_FIELDS },
});

/**
 * `PUT /organization-locations/:id` — the same record fields, no catalogue.
 *
 * Composed from the SAME specs the create form uses, so the label the editor
 * renders, the label the create contract locates by and the label the update
 * contract locates by are one string. Declaring them twice is precisely how the
 * two would drift.
 */
export const updateLocationForm = defineForm({
  fields: { ...RECORD_FIELDS, ...GEO_FIELDS },
});

export const createLocationSchema = createLocationForm.schema;
export const createLocationDefaultValues = createLocationForm.defaults;
export const createLocationFields = createLocationForm.fields;

export type CreateLocationFormValues = InferFormValues<
  typeof createLocationForm
>;

export const updateLocationSchema = updateLocationForm.schema;
export const updateLocationDefaultValues = updateLocationForm.defaults;
export const updateLocationFields = updateLocationForm.fields;

export type UpdateLocationFormValues = InferFormValues<
  typeof updateLocationForm
>;
