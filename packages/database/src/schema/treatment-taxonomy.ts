import {
  clipAgentSourceValues,
  clipFramingValues,
} from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Provenance of a clip's declared agent. Shared by `asset` and `stock_clip` so
 * both storage classes expose an identical descriptor to the matcher.
 *
 * Declared HERE rather than in either table's module because stock_clip is
 * deliberately a dependency leaf (see its header comment) — putting the enum in
 * asset.ts creates an asset -> stock_clip -> asset cycle and a TDZ error at
 * schema load. This module imports nothing from schema/, so it is safe for both.
 *
 * A real pgEnum, not text + $type, so the contract generator resolves it
 * against the shared labels array and emits z.enum() instead of z.string().
 */
export const clipAgentSourceEnum = pgEnum(
  'clip_agent_source',
  clipAgentSourceValues
);

/**
 * How tightly a clip is framed. Lives here alongside clipAgentSourceEnum for
 * the same reason: it is a descriptor shared by both storage classes (`asset`
 * and `stock_clip`), and this module imports nothing from schema/, so neither
 * table's module has to own it.
 *
 * Unlike agent identity, framing IS observable in the frame, so it is safe to
 * infer from pixels and confirm at review.
 */
export const clipFramingEnum = pgEnum('clip_framing', clipFramingValues);

/**
 * Treatment taxonomy — the shared vocabulary that lets footage curated once be
 * matched to services named 1,099 different ways.
 *
 * WHY TWO TABLES AND NOT ONE ENUM
 * -------------------------------
 * A 2026-07-29 audit of production found that 93% of distinct service names
 * (1,025 of 1,099) appear exactly ONCE across the whole customer base. There is
 * no shared naming vocabulary between clinics. The same treatments do, however,
 * collapse onto ~80 shared agents — Profhilo, EMSculpt, Endospheres, Aqualyx.
 * That collapse is the only thing that makes a global footage bank possible;
 * without it, footage would have to be curated per organization forever.
 *
 * The split into `technique` and `treatment_agent` is load-bearing, and it is
 * NOT a taxonomy for its own sake. It separates the axis that is observable in
 * a video frame from the axis that is not:
 *
 *   technique — WHAT KIND of thing is happening. A needle looks like a needle;
 *               a laser handpiece looks like a laser handpiece. Vision models
 *               identify this reliably.
 *
 *   agent     — WHICH SPECIFIC machine or product. Endospheres and EMSculpt are
 *               both a handheld head moved over an abdomen and are visually
 *               indistinguishable. Vision models CANNOT identify this: asked to
 *               describe such footage they hedge to "specialized equipment",
 *               even when given the org's service list. This was measured, not
 *               assumed — see docs/plans/stock-footage-matching-architecture.md.
 *
 * The footage matcher gates strictly on `agent` where it is known (so a clinic
 * doing EMS is never shown endospheres) and falls back to `technique` + region
 * where it is not (so "needle entering a cheek" can legitimately serve filler,
 * Profhilo and mesotherapy alike).
 *
 * WHY ROWS AND NOT pgEnum
 * -----------------------
 * Both are reference TABLES so that adding a treatment is an INSERT, never a
 * migration. This follows the precedent set by `stock_clip.vertical` ("Text,
 * not a pgEnum, so adding a vertical never needs a migration") and is forced by
 * the data: 51 services across 16 orgs are already outside aesthetics entirely
 * (colonic hydrotherapy, float tanks, PEMF, hyperbaric oxygen, ear-wax
 * micro-suction, hearing assessment). A closed enum was tried against the real
 * catalogue and was demonstrably wrong — it filed hyperbaric oxygen and float
 * tanks under "facial device", and matched eyebrow piercing to nothing at all.
 *
 * GLOBAL / NOT org-scoped — shared reference data, like a template catalog,
 * readable by every org. No RLS policy, deliberately.
 */
export const technique = pgTable('technique', {
  /** Stable slug, e.g. 'injection', 'energy_contact', 'laser_light'. */
  slug: text('slug').primaryKey(),

  displayName: text('display_name').notNull(),

  /**
   * What this technique LOOKS LIKE on camera, in the same register clip
   * descriptions are written in ("a fine needle entering skin, gloved hands,
   * close-up"). Used to generate the `expected_shot` text that gets embedded
   * for a service, so that both sides of the similarity comparison are
   * described the same way. Comparing a service NAME to a clip DESCRIPTION
   * compares two different kinds of text and produces a noisy cosine.
   */
  visualSignature: text('visual_signature'),

  /**
   * False for things that have no meaningful procedure shot at all — blood
   * tests, nutrition consultations, credit packs, online courses. The matcher
   * refuses every procedure clip for these BY CONSTRUCTION and routes them to
   * graphics/ambient, rather than hoping no clip happens to score well.
   */
  isProcedural: boolean('is_procedural').notNull().default(true),

  /**
   * Broader technique this one is a special case of, e.g. `radiofrequency`,
   * `ems_stimulation` and `cryolipolysis` all sit under `energy_contact`.
   *
   * Exists to make the match ASYMMETRIC, which is the only way to serve both
   * kinds of service honestly:
   *
   *   - a service that declared a PARENT ("Body Contouring") matches the parent
   *     AND all its children. The clinic told us only the category, so the
   *     whole category is a fair answer — and a handpiece worked over an
   *     abdomen is what body contouring looks like regardless of modality.
   *   - a service that declared a CHILD ("Emsculpt") matches that child ONLY.
   *     Having been told exactly what they do, handing them a different machine
   *     is the failure this design exists to prevent.
   *
   * Without this, splitting a fallback into specific modalities strands the
   * vague services: 0103 promoted six modalities out of `energy_contact` and
   * left every "Body Contouring" service able to reach only the handful of
   * clips whose modality could not be read.
   */
  parentSlug: text('parent_slug').references(
    (): AnyPgColumn => technique.slug,
    {
      onDelete: 'set null',
    }
  ),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const treatmentAgent = pgTable(
  'treatment_agent',
  {
    /**
     * Stable slug, e.g. 'endospheres', 'emsculpt', 'profhilo', 'aqualyx'.
     *
     * An agent need NOT be a brand. For piercing, waxing or threading the agent
     * IS the treatment ('piercing', 'waxing'). Brands appear only where the
     * market actually has them. One column, two populations, no special case.
     */
    slug: text('slug').primaryKey(),

    displayName: text('display_name').notNull(),

    techniqueSlug: text('technique_slug')
      .notNull()
      .references(() => technique.slug, { onDelete: 'restrict' }),

    /**
     * Alternate spellings seen in real service names, used by the name-based
     * classifier that seeds `spec_source = 'inferred_from_name'`.
     * e.g. emsculpt <- 'emsella', 'tesla sculpt', 'hifem', 'ems'.
     * Free-form and additive: a new alias is an UPDATE, not a migration.
     */
    aliases: text('aliases').array().notNull().default([]),

    /**
     * True when two agents of the same technique cannot be told apart on
     * camera — the endospheres/EMS case. Curation MUST supply an agent for
     * clips of these; a technique-grade match would silently substitute one
     * machine for another. Where false (a laser handpiece, a syringe), a
     * technique-grade match is honest and desirable.
     */
    requiresExactMatch: boolean('requires_exact_match')
      .notNull()
      .default(false),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_treatment_agent_technique').on(table.techniqueSlug)]
);

export const techniqueRelations = relations(technique, ({ many }) => ({
  agents: many(treatmentAgent),
}));

export const treatmentAgentRelations = relations(treatmentAgent, ({ one }) => ({
  technique: one(technique, {
    fields: [treatmentAgent.techniqueSlug],
    references: [technique.slug],
  }),
}));

export type Technique = typeof technique.$inferSelect;
export type NewTechnique = typeof technique.$inferInsert;
export type TreatmentAgent = typeof treatmentAgent.$inferSelect;
export type NewTreatmentAgent = typeof treatmentAgent.$inferInsert;
