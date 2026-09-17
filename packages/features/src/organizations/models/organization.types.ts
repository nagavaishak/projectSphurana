import type { OrganizationFields } from '@borradh-workspace/contracts';

/**
 * Organization entity type — DERIVED from the wire contract, not hand-listed.
 *
 * This interface used to duplicate `organizationSchema` field for field, and
 * the two drifted the moment one was extended: adding a column to the response
 * schema left the type the frontend queries with silently missing it, so a
 * field the API really returned was a type error to read.
 *
 * `createdAt` is the one deliberate difference. The wire carries an ISO STRING;
 * the backend entity holds a `Date`. api-client then applies `Serialize<>` to
 * turn it back into a string for the client — so the round trip is
 *
 *   organizationSchema (string) → Organization (Date) → Serialize<> (string)
 *
 * and every OTHER field flows through untouched. Add a field to the response
 * schema and it appears here and in api-client automatically.
 *
 * No cycle: `contracts` is pure Zod + labels and never imports `features`.
 */
export type Organization = Omit<OrganizationFields, 'createdAt'> & {
  createdAt: Date;
};

/**
 * Organization member type
 */
export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
}

/**
 * Organization roles
 */
export type OrganizationRole = 'owner' | 'admin' | 'member';
