import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './organization.js';

/**
 * A Facebook Login for Business connection that arrived BEFORE anyone knew
 * which workspace it belongs to.
 *
 * The sales-led flow sends a prospect a link, they authorise, and the callback
 * lands with a token and no session — no org, no user, often no Borradh
 * account yet. That is the whole point: the connection can be made during the
 * sales conversation and attached afterwards.
 *
 * DELIBERATELY NOT org-scoped, and therefore NOT RLS-policied: a row with an
 * organizationId would defeat the purpose, and the only readers are the admin
 * terminal (cross-tenant by construction) and the org-less callback that
 * writes it. `claimedByOrganizationId` records where a row ENDED UP, for the
 * audit trail — it is not a scope.
 *
 * The discovered assets are stored so an operator can recognise whose
 * connection this is. The Page name is the identity here, which is why this
 * needs no claim code the way the Stripe self-serve flow does.
 */
export const metaPendingConnection = pgTable('meta_pending_connection', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  /** The FLfB system-user token, encrypted. Never leaves the server. */
  encryptedCredentials: text('encrypted_credentials').notNull(),

  /**
   * Null for an FLfB token, which never expires. A non-null value here means
   * Meta handed back something short-lived and the connection is not what the
   * flow promised — surfaced rather than silently accepted.
   */
  tokenExpiresAt: timestamp('token_expires_at'),

  /** Who authorised, as Meta reports them. For the operator's recognition. */
  metaUserName: text('meta_user_name'),

  availablePages: jsonb('available_pages')
    .$type<
      Array<{
        id: string;
        name: string;
        category: string | null;
        businessId: string | null;
        businessName: string | null;
        instagramUsername: string | null;
      }>
    >()
    .notNull(),
  /**
   * What Meta actually granted, read back from debug_token at callback time.
   *
   * The FLfB configuration is not readable through the Graph API, so this is
   * the ONLY way to learn what its permission set really contains — and a
   * missing permission is otherwise invisible until a post fails weeks later.
   * `instagram_content_publish` is the one that bites: publishing goes through
   * the Page token, and there is no standalone Instagram path any more.
   */
  grantedScopes: jsonb('granted_scopes')
    .$type<string[]>()
    .notNull()
    .default([]),

  availableAdAccounts: jsonb('available_ad_accounts')
    .$type<Array<{ id: string; name: string; currency: string | null }>>()
    .notNull(),

  /** Set when an operator attaches this to a workspace. */
  claimedByOrganizationId: text('claimed_by_organization_id').references(
    () => organization.id,
    { onDelete: 'set null' }
  ),
  claimedAt: timestamp('claimed_at'),
  /** Kept after claiming so the audit trail survives; filtered from the list. */
  isClaimed: boolean('is_claimed').default(false).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const metaPendingConnectionRelations = relations(
  metaPendingConnection,
  ({ one }) => ({
    claimedByOrganization: one(organization, {
      fields: [metaPendingConnection.claimedByOrganizationId],
      references: [organization.id],
    }),
  })
);

export type MetaPendingConnection = typeof metaPendingConnection.$inferSelect;
export type NewMetaPendingConnection =
  typeof metaPendingConnection.$inferInsert;
