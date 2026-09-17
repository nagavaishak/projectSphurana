/**
 * Whether the Claire v3 full-screen `/assistant` route is exposed for an org.
 *
 * As of 2026-04-26, v3 is generally available — gating removed (`CLAIRE_V3_ENABLED`
 * + `CLAIRE_V3_ALLOW_ORG_IDS` env vars are no-ops, kept on the env schema only so
 * existing Pulumi configs don't fail validation on next deploy). Function retained
 * for the existing `GET /assistant/v3-status` endpoint contract; always returns true.
 */
export const isClaireV3EnabledForOrg = (_organizationId: string): boolean => {
  return true;
};
