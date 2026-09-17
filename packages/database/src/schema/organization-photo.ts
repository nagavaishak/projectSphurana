import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';

/**
 * Photos shown in the gallery of the public venue page (the Fresha-style
 * hero: one large image + two stacked, behind a "See all images" lightbox).
 *
 * Why a table and not a `photos text[]` column on `organization`:
 *   - each photo carries its own caption + ordering, and the dashboard
 *     reorders them by drag, which an array column makes miserable;
 *   - the cover photo is a property OF a photo, not of the org.
 *
 * `url` is a plain public URL, exactly like `organization.logo` and
 * `practitioner.photo`. The dashboard uploads via POST /upload/presigned-url
 * with `purpose: 'profile'`, which lands the object in the PUBLIC S3 bucket
 * and returns the durable URL we store here. Nothing signed is ever persisted
 * (a signed URL would expire and rot the venue page).
 */
export const organizationPhoto = pgTable(
  'organization_photo',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // The venue (location) this photo belongs to. A venue IS a location, so a
    // gallery is a location's gallery. `organizationId` is kept alongside for
    // RLS (org_isolation scopes on it); `locationId` is what the venue page
    // filters by. Nullable so the column can be added to a table that may
    // already hold rows, and so an org-wide photo (no specific branch) is
    // expressible; the venue page treats null-location photos as shared.
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'cascade',
    }),

    url: text('url').notNull(),
    caption: text('caption'),

    // Gallery ordering. The lowest sortOrder is the hero image unless a photo
    // is explicitly marked as the cover.
    sortOrder: integer('sort_order').notNull().default(0),

    // At most one cover per org — enforced in the service layer (set-cover
    // clears the flag on the org's other photos in the same transaction)
    // rather than by a partial unique index, so that reordering never has to
    // fight a constraint mid-update.
    isCover: boolean('is_cover').notNull().default(false),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The venue page's only query: WHERE organization_id = ? ORDER BY sort_order
    // The venue page's query: WHERE location_id = ? ORDER BY sort_order.
    index('idx_organization_photo_location_sort').on(
      table.locationId,
      table.sortOrder
    ),
    index('idx_organization_photo_org_sort').on(
      table.organizationId,
      table.sortOrder
    ),
  ]
);

export const organizationPhotoRlsPolicy = orgRlsPolicy(organizationPhoto);

export const organizationPhotoRelations = relations(
  organizationPhoto,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationPhoto.organizationId],
      references: [organization.id],
    }),
    location: one(organizationLocation, {
      fields: [organizationPhoto.locationId],
      references: [organizationLocation.id],
    }),
  })
);

export type OrganizationPhoto = typeof organizationPhoto.$inferSelect;
export type NewOrganizationPhoto = typeof organizationPhoto.$inferInsert;
