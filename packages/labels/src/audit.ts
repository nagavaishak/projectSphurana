/**
 * Audit log enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

export const auditActionLabels = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  restore: 'Restore',
} as const;

export const auditActionValues = Object.keys(auditActionLabels) as [
  keyof typeof auditActionLabels,
  ...(keyof typeof auditActionLabels)[],
];

export type AuditAction = keyof typeof auditActionLabels;

export const auditActorTypeLabels = {
  user: 'User',
  system: 'System',
  job: 'Job',
} as const;

export const auditActorTypeValues = Object.keys(auditActorTypeLabels) as [
  keyof typeof auditActorTypeLabels,
  ...(keyof typeof auditActorTypeLabels)[],
];

export type AuditActorType = keyof typeof auditActorTypeLabels;
