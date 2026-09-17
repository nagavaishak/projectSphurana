import {
  createTeamMemberRequestBase,
  teamMemberWageConfigRequestSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Partial wage-config patch accepted by the team-member orchestration.
 *
 * DERIVED: this IS the canonical wire schema
 * (`teamMemberWageConfigRequestSchema`), re-exported under its historic name. It
 * takes no server-injected fields of its own — the orchestration supplies
 * `organizationId`/`practitionerId` when it forwards the patch to the wage
 * config upsert.
 */
export const teamMemberWageConfigSchema = teamMemberWageConfigRequestSchema;

export type TeamMemberWageConfigInput = z.infer<
  typeof teamMemberWageConfigSchema
>;

/**
 * Input for the `createTeamMember` orchestration (spec §6 "Save semantics").
 *
 * DERIVED from the canonical wire contract (`createTeamMemberRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. The body carries the full practitioner profile, the
 * association sets (services/locations), a partial wage-config patch, and a
 * `permissionLevel` that maps to the invited member's org role; the server adds
 * the active org and the acting user. Field rules live in the contract.
 */
export const createTeamMemberSchema = createTeamMemberRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  inviterId: z.string().min(1, 'Inviter user ID is required'),
});

export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;
