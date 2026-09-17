import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  integrationTypeLabels,
  integrationTypeValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { integrationTypeLabels, integrationTypeValues };
export type { IntegrationType } from '@borradh-workspace/labels';

// Database enums
export const integrationTypeEnum = pgEnum(
  'integration_type',
  integrationTypeValues
);

export const organizationIntegration = pgTable(
  'organization_integration',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    type: integrationTypeEnum('type').notNull(),
    isActive: boolean('is_active').default(false),
    config: jsonb('config'),
    encryptedCredentials: text('encrypted_credentials'),
    lastSyncAt: timestamp('last_sync_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('unique_org_type').on(table.organizationId, table.type)]
);

export const organizationIntegrationRlsPolicy = orgRlsPolicy(
  organizationIntegration
);

export type OrganizationIntegration =
  typeof organizationIntegration.$inferSelect;
export type NewOrganizationIntegration =
  typeof organizationIntegration.$inferInsert;
