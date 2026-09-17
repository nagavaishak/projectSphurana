import {
  auditActionLabels,
  auditActionValues,
  auditActorTypeLabels,
  auditActorTypeValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

export {
  auditActionLabels,
  auditActionValues,
  auditActorTypeLabels,
  auditActorTypeValues,
};
export type { AuditAction, AuditActorType } from '@borradh-workspace/labels';

export const auditActionEnum = pgEnum('audit_action', auditActionValues);
export const auditActorTypeEnum = pgEnum(
  'audit_actor_type',
  auditActorTypeValues
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    action: auditActionEnum('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_log_entity').on(table.entityType, table.entityId),
    index('idx_audit_log_org_id').on(table.organizationId),
    index('idx_audit_log_created_at').on(table.createdAt),
  ]
);

export const auditLogRlsPolicy = orgRlsPolicy(auditLog);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
