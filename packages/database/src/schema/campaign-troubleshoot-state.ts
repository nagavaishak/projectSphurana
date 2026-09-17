import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

/**
 * Campaign troubleshooting lifecycle state (PRD-1 — Claire Campaign
 * Troubleshooting Framework, Task 2).
 *
 * One row per (org, Meta campaign) tracks where a campaign sits in the
 * diagnose → adjust-offer → refresh-creative → escalate loop. Persisted as a
 * dedicated table rather than inferred from timestamps so the reactive skill
 * and the proactive `fourDayNoLeads` trigger read one shared source of truth
 * for "which round are we on, and have we already escalated to a human?".
 *
 * Round semantics (see the framework's campaign-lifecycle rules):
 *   - `none`               → nothing tried yet; first diagnosis.
 *   - `offer_adjusted`     → round 1 applied (lowered intro price, same
 *                            service). `offersTried` records what we changed to.
 *   - `creative_refreshed` → round 2 applied (new creative, same offer).
 *                            `creativesTried` records the assets shipped.
 * After two rounds with no improvement the campaign is escalated to a human
 * (Senan/Louis) — `escalatedAt` is stamped and the loop stops advancing.
 */
export const campaignTroubleshootRoundValues = [
  'none',
  'offer_adjusted',
  'creative_refreshed',
] as const;

export type CampaignTroubleshootRound =
  (typeof campaignTroubleshootRoundValues)[number];

export const campaignTroubleshootRoundEnum = pgEnum(
  'campaign_troubleshoot_round',
  campaignTroubleshootRoundValues
);

export const campaignTroubleshootState = pgTable(
  'campaign_troubleshoot_state',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Meta's campaign id (global), scoped unique per org below.
    metaCampaignId: text('meta_campaign_id').notNull(),

    currentRound: campaignTroubleshootRoundEnum('current_round')
      .notNull()
      .default('none'),

    // Free-form audit trail of offers/creatives attempted across rounds, so
    // an escalation hand-off can show "here's everything we already tried".
    offersTried: jsonb('offers_tried')
      .$type<CampaignTroubleshootAttempt[]>()
      .notNull()
      .default([]),
    creativesTried: jsonb('creatives_tried')
      .$type<CampaignTroubleshootAttempt[]>()
      .notNull()
      .default([]),

    escalatedAt: timestamp('escalated_at'),
    lastDiagnosedAt: timestamp('last_diagnosed_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One troubleshoot row per (org, campaign).
    unique('campaign_troubleshoot_state_org_campaign_unique').on(
      table.organizationId,
      table.metaCampaignId
    ),
    index('idx_campaign_troubleshoot_state_org_id').on(table.organizationId),
  ]
);

/**
 * A single thing we changed during a round — recorded for the escalation
 * hand-off. `note` carries a human description (e.g. "intro price €99 → €69");
 * `at` is the ISO timestamp the change was applied. `ref` optionally links to
 * the created offer/video id.
 */
export type CampaignTroubleshootAttempt = {
  note: string;
  at: string;
  ref?: string;
};

export const campaignTroubleshootStateRelations = relations(
  campaignTroubleshootState,
  ({ one }) => ({
    organization: one(organization, {
      fields: [campaignTroubleshootState.organizationId],
      references: [organization.id],
    }),
  })
);

export const campaignTroubleshootStateRlsPolicy = orgRlsPolicy(
  campaignTroubleshootState
);

export type CampaignTroubleshootState =
  typeof campaignTroubleshootState.$inferSelect;
export type NewCampaignTroubleshootState =
  typeof campaignTroubleshootState.$inferInsert;
