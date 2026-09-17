import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

/**
 * Google My Business accounts connected to an organization.
 * Stores OAuth credentials and location info for review link generation.
 */
export const googleMyBusinessAccount = pgTable(
  'google_my_business_account',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    connectedById: text('connected_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    googleAccountEmail: text('google_account_email').notNull(),
    accountName: text('account_name').notNull(),
    locationId: text('location_id').notNull(),
    locationName: text('location_name').notNull(),
    placeId: text('place_id').notNull(),
    reviewLink: text('review_link').notNull(),
    averageRating: numeric('average_rating', { precision: 2, scale: 1 }),
    totalReviews: integer('total_reviews').default(0),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    tokenExpiresAt: timestamp('token_expires_at'),
    lastSyncAt: timestamp('last_sync_at'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_org_location').on(table.organizationId, table.locationId),
    index('idx_gmb_account_connected_by_id').on(table.connectedById),
  ]
);

export const googleMyBusinessAccountRlsPolicy = orgRlsPolicy(
  googleMyBusinessAccount
);

export const googleMyBusinessAccountRelations = relations(
  googleMyBusinessAccount,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [googleMyBusinessAccount.organizationId],
      references: [organization.id],
    }),
    connectedBy: one(user, {
      fields: [googleMyBusinessAccount.connectedById],
      references: [user.id],
    }),
    reviews: many(googleReview),
  })
);

export type GoogleMyBusinessAccount =
  typeof googleMyBusinessAccount.$inferSelect;
export type NewGoogleMyBusinessAccount =
  typeof googleMyBusinessAccount.$inferInsert;

/**
 * Synced Google reviews for a Google My Business account.
 */
export const googleReview = pgTable(
  'google_review',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    googleMyBusinessAccountId: text('google_my_business_account_id')
      .notNull()
      .references(() => googleMyBusinessAccount.id, { onDelete: 'cascade' }),
    reviewId: text('review_id').notNull(),
    reviewerName: text('reviewer_name').notNull(),
    reviewerPhotoUrl: text('reviewer_photo_url'),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    replyComment: text('reply_comment'),
    repliedAt: timestamp('replied_at'),
    publishedAt: timestamp('published_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_account_review').on(
      table.googleMyBusinessAccountId,
      table.reviewId
    ),
  ]
);

export const googleReviewRelations = relations(googleReview, ({ one }) => ({
  account: one(googleMyBusinessAccount, {
    fields: [googleReview.googleMyBusinessAccountId],
    references: [googleMyBusinessAccount.id],
  }),
}));

// Bucket B1: google_review has no organization_id; org scope derives from the
// parent google_my_business_account row via google_my_business_account_id FK.
export const googleReviewRlsPolicy = childOrgRlsPolicy(googleReview, {
  parent: 'google_my_business_account',
  fk: 'google_my_business_account_id',
});

export type GoogleReview = typeof googleReview.$inferSelect;
export type NewGoogleReview = typeof googleReview.$inferInsert;
