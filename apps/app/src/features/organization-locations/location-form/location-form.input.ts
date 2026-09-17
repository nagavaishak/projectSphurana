import type { CountryCode } from '../api/types';

/**
 * Typed intent for creating a location — the RAW form shape, not the wire body.
 *
 * Optional address parts are plain strings here (a blank input is `''`, not
 * `undefined`); folding `''` into the `null` the contract wants is the payload
 * builder's job, in one place. That coalesce is the whole reason this type and
 * the body type are different: `POST /leads` once 400'd because a blank
 * optional went out as `''`.
 */
export interface CreateLocationIntent {
  name: string;
  isPrimary: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  county: string;
  postalCode: string;
  country: CountryCode;
  /** From the address search, never typed. */
  latitude: number | null;
  longitude: number | null;

  /**
   * The catalogue seed. ADDITIVE — these ids become `(entity, thisLocation)`
   * rows and nothing else; see `locationCatalogSeedRequestSchema`. All empty is
   * the default and produces no `catalog` key on the wire at all.
   */
  copyFromLocationId: string | null;
  practitionerIds: string[];
  serviceIds: string[];
  productIds: string[];
  membershipPlanIds: string[];
  offerIds: string[];
}

/**
 * Typed intent for updating a location — the record fields only.
 *
 * A branch's catalogue is a separate endpoint once the branch exists
 * (`PUT /organization-locations/:id/catalog`), so it is deliberately absent
 * here rather than optional: there is no path through this body that writes it.
 */
export type UpdateLocationIntent = Omit<
  CreateLocationIntent,
  | 'copyFromLocationId'
  | 'practitionerIds'
  | 'serviceIds'
  | 'productIds'
  | 'membershipPlanIds'
  | 'offerIds'
>;
