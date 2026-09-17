import {
  type LeadSource,
  type LeadStatus,
  type SegmentFilter,
  lead,
} from '@borradh-workspace/database';
import {
  type SQL,
  arrayOverlaps,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { notDeleted } from '../../../shared/index.js';

/**
 * Translate a saved {@link SegmentFilter} into drizzle WHERE conditions over
 * the `lead` table. Mirrors the list-leads filter so segment evaluation and the
 * leads list stay in lock-step, extended with createdAt / lastContactedAt
 * windows for re-engagement segments.
 *
 * Always scopes to the org and excludes soft-deleted leads. Returns the raw
 * condition array; callers combine with `and(...)`.
 */
export function buildSegmentWhere(
  organizationId: string,
  filter: SegmentFilter
): SQL[] {
  const conditions: SQL[] = [
    eq(lead.organizationId, organizationId),
    notDeleted(lead),
  ];

  if (filter.status && filter.status.length > 0) {
    conditions.push(inArray(lead.status, filter.status as LeadStatus[]));
  }

  if (filter.source && filter.source.length > 0) {
    conditions.push(inArray(lead.source, filter.source as LeadSource[]));
  }

  if (filter.tags && filter.tags.length > 0) {
    conditions.push(arrayOverlaps(lead.tags, filter.tags));
  }

  if (filter.consentEmail !== undefined) {
    conditions.push(eq(lead.consentEmail, filter.consentEmail));
  }

  if (filter.consentSms !== undefined) {
    conditions.push(eq(lead.consentSms, filter.consentSms));
  }

  if (filter.search) {
    const term = `%${filter.search}%`;
    const fullName = sql`COALESCE(${lead.firstName}, '') || ' ' || COALESCE(${lead.lastName}, '')`;
    const searchCondition = or(
      ilike(lead.firstName, term),
      ilike(lead.lastName, term),
      ilike(lead.email, term),
      ilike(lead.phone, term),
      ilike(fullName, term)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (filter.createdFrom) {
    conditions.push(gte(lead.createdAt, new Date(filter.createdFrom)));
  }
  if (filter.createdTo) {
    conditions.push(lte(lead.createdAt, new Date(filter.createdTo)));
  }

  if (filter.lastContactedAfter) {
    conditions.push(
      gte(lead.lastContactedAt, new Date(filter.lastContactedAfter))
    );
  }
  if (filter.lastContactedBefore) {
    conditions.push(
      lte(lead.lastContactedAt, new Date(filter.lastContactedBefore))
    );
  }

  return conditions;
}
