import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organization } from './organization.js';

// =============================================================================
// TABLES
// =============================================================================

/**
 * VoiceEmbedding - Stores customer/business message pairs with vector embeddings
 * for voice cloning semantic search.
 * Requires pgvector extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
export const voiceEmbedding = pgTable(
  'voice_embedding',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    metaAdsPageId: text('meta_ads_page_id').references(() => metaAdsPage.id, {
      onDelete: 'cascade',
    }),

    // The customer question and the business reply
    customerMessage: text('customer_message').notNull(),
    businessReply: text('business_reply').notNull(),

    // OpenAI text-embedding-3-small (1536 dimensions) of customerMessage
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),

    // When the original exchange happened
    messageTimestamp: timestamp('message_timestamp'),

    // Extra data
    metadata: jsonb('metadata'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_voice_embedding_org_id').on(table.organizationId),
    index('idx_voice_embedding_meta_ads_page_id').on(table.metaAdsPageId),
    index('idx_voice_embedding_vector').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
  ]
);

export const voiceEmbeddingRlsPolicy = orgRlsPolicy(voiceEmbedding);

// =============================================================================
// RELATIONS
// =============================================================================

export const voiceEmbeddingRelations = relations(voiceEmbedding, ({ one }) => ({
  organization: one(organization, {
    fields: [voiceEmbedding.organizationId],
    references: [organization.id],
  }),
  metaAdsPage: one(metaAdsPage, {
    fields: [voiceEmbedding.metaAdsPageId],
    references: [metaAdsPage.id],
  }),
}));

// =============================================================================
// TYPES
// =============================================================================

export type VoiceEmbedding = typeof voiceEmbedding.$inferSelect;
export type NewVoiceEmbedding = typeof voiceEmbedding.$inferInsert;
