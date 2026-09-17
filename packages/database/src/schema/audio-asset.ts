import type { AudioAssetKind } from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// Audio Asset schema.
//
// Memoization storage for synthesized audio in the video template engine:
//   - TTS narration keyed by sha256(script + voice)
//   - Whisper caption transcripts keyed by sha256(audioUrl)
//
// One row per (organization, kind, hash) tuple. The TTS path uploads the
// generated mp3 to S3 and stores its CDN/URL here; the captions path stores
// the transcript JSON inline (no S3 round-trip needed).

export const audioAsset = pgTable(
  'audio_asset',
  {
    id: text('id').primaryKey(),

    // 'tts' or 'captions' — see audioAssetKindLabels in @borradh-workspace/labels.
    kind: text('kind').$type<AudioAssetKind>().notNull(),

    // sha256 hex of the memoization key (script+voice for tts, audioUrl
    // for captions). Combined with kind + organizationId for uniqueness.
    hash: text('hash').notNull(),

    // Where the audio lives (TTS only — S3 key or full URL). Null for the
    // captions kind, which has no associated audio file of its own.
    url: text('url'),

    // Duration in milliseconds (TTS only — when known).
    durationMs: integer('duration_ms'),

    // For 'captions': resolved caption pages JSON.
    // For 'tts': free-slot metadata (voice id, sample rate, etc.).
    payload: text('payload'),

    // Org scope. Hash is org-scoped so two orgs with the same script don't
    // share private audio.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_audio_asset_org_id').on(table.organizationId),
    uniqueIndex('uq_audio_asset_lookup').on(
      table.organizationId,
      table.kind,
      table.hash
    ),
  ]
);

export const audioAssetRlsPolicy = orgRlsPolicy(audioAsset);

export const audioAssetRelations = relations(audioAsset, ({ one }) => ({
  organization: one(organization, {
    fields: [audioAsset.organizationId],
    references: [organization.id],
  }),
}));

export type AudioAsset = typeof audioAsset.$inferSelect;
export type NewAudioAsset = typeof audioAsset.$inferInsert;
