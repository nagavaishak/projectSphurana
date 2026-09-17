import { lead, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, eq, inArray, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ImportLeadRow,
  type ImportLeadsInput,
  type ImportLeadsResult,
  importLeadRowSchema,
  importLeadsSchema,
} from './import-leads.schema.js';

const BATCH_SIZE = 100;

/**
 * Build dedup key for a lead row
 */
function getDeduplicateKey(
  row: { email?: string | null; phone?: string | null },
  deduplicateBy: ImportLeadsInput['deduplicateBy']
): string | null {
  switch (deduplicateBy) {
    case 'email':
      return row.email?.toLowerCase() || null;
    case 'phone':
      return row.phone || null;
    case 'email_and_phone':
      return row.email && row.phone
        ? `${row.email.toLowerCase()}|${row.phone}`
        : null;
    case 'none':
      return null;
  }
}

/**
 * Merge tags: combine existing tags with new tags and default tags, deduplicating
 */
function mergeTags(
  existing: string[] | null,
  incoming: string[] | undefined,
  defaultTags: string[] | undefined
): string[] | undefined {
  const tags = new Set<string>();
  if (existing) for (const t of existing) tags.add(t);
  if (incoming) for (const t of incoming) tags.add(t);
  if (defaultTags) for (const t of defaultTags) tags.add(t);
  return tags.size > 0 ? [...tags] : undefined;
}

/**
 * Internal implementation of import leads
 */
const importLeadsImpl = async (db: DbConnection, input: ImportLeadsInput) => {
  // Validate input
  const parsed = importLeadsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    leads: inputLeads,
    deduplicateBy,
    onDuplicate,
    defaultTags,
    defaultConsentEmail,
    defaultConsentSms,
    defaultConsentVoice,
  } = parsed.data;

  const result: ImportLeadsResult = {
    imported: 0,
    skipped: 0,
    updated: 0,
    errors: [],
  };

  // Step 1: Validate individual lead rows and collect valid ones
  const validLeads: { index: number; data: ImportLeadRow }[] = [];
  for (let i = 0; i < inputLeads.length; i++) {
    const row = inputLeads[i];
    // Each row must have at least firstName or email
    if (!row.firstName && !row.email) {
      result.errors.push({
        row: i + 1,
        message: 'Lead must have at least a first name or email',
        data: row as unknown as Record<string, unknown>,
      });
      continue;
    }

    const rowParsed = importLeadRowSchema.safeParse(row);
    if (!rowParsed.success) {
      result.errors.push({
        row: i + 1,
        message: rowParsed.error.issues
          .map((issue) => issue.message)
          .join(', '),
        data: row as unknown as Record<string, unknown>,
      });
      continue;
    }

    validLeads.push({ index: i, data: rowParsed.data });
  }

  if (validLeads.length === 0) {
    return ok(result);
  }

  // Step 2: Find existing leads for deduplication
  type ExistingLead = typeof lead.$inferSelect;
  const existingMap = new Map<string, ExistingLead>();

  if (deduplicateBy !== 'none') {
    const existingLeads = await findExistingLeads(
      db,
      organizationId,
      validLeads.map((l) => l.data),
      deduplicateBy
    );

    for (const existing of existingLeads) {
      const key = getDeduplicateKey(
        {
          email: existing.email ?? undefined,
          phone: existing.phone ?? undefined,
        },
        deduplicateBy
      );
      if (key) {
        existingMap.set(key, existing);
      }
    }
  }

  // Step 3: Categorize leads
  const toInsert: { index: number; data: ImportLeadRow }[] = [];
  const toUpdate: {
    index: number;
    data: ImportLeadRow;
    existing: ExistingLead;
  }[] = [];

  for (const item of validLeads) {
    const key = getDeduplicateKey(item.data, deduplicateBy);

    if (key && existingMap.has(key)) {
      // biome-ignore lint/style/noNonNullAssertion: key is guaranteed to exist (checked by existingMap.has)
      const existing = existingMap.get(key)!;
      switch (onDuplicate) {
        case 'skip':
          result.skipped++;
          break;
        case 'update':
          toUpdate.push({ ...item, existing });
          break;
        case 'create_new':
          toInsert.push(item);
          break;
      }
    } else {
      toInsert.push(item);
    }
  }

  // Step 4: Batch insert new leads
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    try {
      await db.insert(lead).values(
        batch.map(({ data }) => {
          const consentEmail = data.consentEmail ?? defaultConsentEmail;
          const consentSms = data.consentSms ?? defaultConsentSms;
          const consentVoice = data.consentVoice ?? defaultConsentVoice;
          const hasConsent = consentEmail || consentSms || consentVoice;
          return {
            organizationId,
            firstName: data.firstName || data.email || 'Unknown',
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            whatsapp: data.whatsapp,
            source: data.source,
            tags: mergeTags(null, data.tags, defaultTags),
            notes: data.notes,
            consentEmail,
            consentSms,
            consentVoice,
            consentSource: 'csv_import' as const,
            consentedAt: hasConsent ? new Date() : null,
          };
        })
      );
      result.imported += batch.length;
    } catch (error) {
      logError('leads.importLeads.batchInsert', error, {
        feature: 'leads',
        extra: { batchStart: i, batchSize: batch.length },
      });
      // Mark all in batch as errors
      for (const item of batch) {
        result.errors.push({
          row: item.index + 1,
          message: 'Failed to insert lead',
        });
      }
    }
  }

  // Step 5: Update existing leads
  for (const { index, data, existing } of toUpdate) {
    try {
      const updateValues: Record<string, unknown> = {};
      if (data.firstName) updateValues.firstName = data.firstName;
      if (data.lastName) updateValues.lastName = data.lastName;
      if (data.phone) updateValues.phone = data.phone;
      if (data.whatsapp) updateValues.whatsapp = data.whatsapp;
      if (data.notes) updateValues.notes = data.notes;

      const mergedTags = mergeTags(existing.tags, data.tags, defaultTags);
      if (mergedTags) updateValues.tags = mergedTags;

      if (Object.keys(updateValues).length > 0) {
        await db
          .update(lead)
          .set(updateValues)
          .where(and(eq(lead.id, existing.id), notDeleted(lead)));
      }
      result.updated++;
    } catch (error) {
      logError('leads.importLeads.update', error, {
        feature: 'leads',
        extra: { leadId: existing.id },
      });
      result.errors.push({
        row: index + 1,
        message: 'Failed to update existing lead',
      });
    }
  }

  return ok(result);
};

/**
 * Find existing leads matching dedup criteria
 */
async function findExistingLeads(
  db: DbConnection,
  organizationId: string,
  leads: ImportLeadRow[],
  deduplicateBy: ImportLeadsInput['deduplicateBy']
): Promise<(typeof lead.$inferSelect)[]> {
  const conditions: SQL[] = [];

  if (deduplicateBy === 'email' || deduplicateBy === 'email_and_phone') {
    const emails = leads
      .map((l) => l.email?.toLowerCase())
      .filter((e): e is string => !!e);
    if (emails.length > 0) {
      conditions.push(inArray(lead.email, emails));
    }
  }

  if (deduplicateBy === 'phone' || deduplicateBy === 'email_and_phone') {
    const phones = leads.map((l) => l.phone).filter((p): p is string => !!p);
    if (phones.length > 0) {
      conditions.push(inArray(lead.phone, phones));
    }
  }

  if (conditions.length === 0) {
    return [];
  }

  const matchCondition =
    conditions.length === 1 ? conditions[0] : or(...conditions);

  return db.query.lead.findMany({
    where: and(
      eq(lead.organizationId, organizationId),
      matchCondition,
      notDeleted(lead)
    ),
  });
}

/**
 * Import leads in bulk with deduplication
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Import input with leads array and options
 * @returns Result with import summary
 */
export const importLeads = (db: DbConnection, input: ImportLeadsInput) =>
  trackedResult(
    'leads.importLeads',
    () => withOrgScope((tx) => importLeadsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadCount: input.leads.length,
        deduplicateBy: input.deduplicateBy,
      },
    }
  );
