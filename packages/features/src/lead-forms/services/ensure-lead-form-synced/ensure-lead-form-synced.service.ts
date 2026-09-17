import { leadForm, organizationService } from '@borradh-workspace/database';
import type { LeadFormQuestion } from '@borradh-workspace/database';
import type { MetaAdsService } from '@borradh-workspace/integrations';
import {
  fromMetaQuestionType,
  leadFormFieldTypeValues,
} from '@borradh-workspace/labels';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';
import {
  type ServiceCandidate,
  suggestServiceForForm,
} from './suggest-service-for-form.js';

const logger = createLogger('EnsureLeadFormSynced');

const FIELD_TYPES = new Set<string>(leadFormFieldTypeValues);

export interface EnsureLeadFormSyncedInput {
  organizationId: string;
  /** Meta's lead form id (from the leadgen webhook). */
  metaFormId: string;
  /** Internal metaAdsPage.id this form belongs to, if known. */
  metaPageInternalId: string | null;
  /** Meta API client scoped to the form's page. */
  metaService: Pick<MetaAdsService, 'getLeadGenForm'>;
}

function mapQuestions(
  questions: { type: string; label?: string; key?: string; options?: unknown }[]
): LeadFormQuestion[] {
  return questions.map((q) => {
    // Meta's enum is its own vocabulary (it calls date of birth DOB), so
    // translate before deciding whether we recognise the type.
    const ourType = fromMetaQuestionType(q.type);
    return {
      type: (FIELD_TYPES.has(ourType)
        ? ourType
        : 'CUSTOM') as LeadFormQuestion['type'],
      ...(q.label ? { label: q.label } : {}),
      ...(q.key ? { key: q.key } : {}),
      ...(Array.isArray(q.options)
        ? { options: q.options as LeadFormQuestion['options'] }
        : {}),
    };
  });
}

function buildFormText(name: string, questions: LeadFormQuestion[]): string {
  return [
    name,
    ...questions.map((q) => q.label ?? ''),
    ...questions.map((q) => q.key ?? ''),
  ].join(' ');
}

/**
 * Ensure the Meta lead form behind a submitted lead exists in our DB and, when
 * confident, is linked to an organization service.
 *
 * Most production lead forms are created directly in Meta Ads Manager, so they
 * never reach the `lead_form` table and their ads aren't service-tagged — which
 * is why the chatbot can't tell which service a lead-form lead enquired about.
 * This lazily backfills the form definition on first sight of a lead, and
 * auto-suggests the service by matching the form name/questions to the org's
 * services. Best-effort: never throws (webhook processing must not fail here).
 */
export async function ensureLeadFormSynced(
  db: DbConnection,
  input: EnsureLeadFormSyncedInput
): Promise<void> {
  const { organizationId, metaFormId, metaPageInternalId, metaService } = input;

  try {
    const existing = await db.query.leadForm.findFirst({
      where: and(
        eq(leadForm.organizationId, organizationId),
        eq(leadForm.metaFormId, metaFormId)
      ),
      columns: {
        id: true,
        name: true,
        organizationServiceId: true,
        questions: true,
      },
    });

    // Already linked to a service (auto or manual) — nothing to do.
    if (existing?.organizationServiceId) return;

    let name: string;
    let questions: LeadFormQuestion[];
    let privacyPolicyUrl = '';
    const isNew = !existing;

    if (existing) {
      name = existing.name;
      questions = (existing.questions as LeadFormQuestion[] | null) ?? [];
    } else {
      // Fetch the form definition from Meta (only on first sight of the form).
      const metaForm = await metaService
        .getLeadGenForm(metaFormId)
        .catch((error: unknown) => {
          logError('leadForms.ensureLeadFormSynced.fetch', error, {
            feature: 'lead-forms',
            extra: { metaFormId, organizationId },
          });
          return null;
        });
      if (!metaForm) return;
      name = metaForm.name || 'Lead form';
      questions = mapQuestions(metaForm.questions ?? []);
      privacyPolicyUrl = metaForm.privacyPolicyUrl ?? '';
    }

    // Auto-suggest the service from the form text.
    const services: ServiceCandidate[] =
      await db.query.organizationService.findMany({
        where: and(
          eq(organizationService.organizationId, organizationId),
          eq(organizationService.isActive, true)
        ),
        columns: { id: true, name: true },
      });
    const suggestion =
      services.length > 0
        ? suggestServiceForForm(buildFormText(name, questions), services)
        : null;

    if (isNew) {
      await db.insert(leadForm).values({
        organizationId,
        name,
        status: 'synced',
        questions,
        privacyPolicyUrl,
        followUpChannel: 'none',
        metaFormId,
        metaPageId: metaPageInternalId,
        lastSyncAt: new Date(),
        ...(suggestion
          ? {
              organizationServiceId: suggestion.serviceId,
              serviceLinkSource: 'suggested' as const,
            }
          : {}),
      });
      logger.info('Synced Meta-native lead form', {
        metaFormId,
        organizationId,
        suggestedServiceId: suggestion?.serviceId ?? null,
        suggestionScore: suggestion?.score ?? null,
      });
    } else if (existing && suggestion) {
      await db
        .update(leadForm)
        .set({
          organizationServiceId: suggestion.serviceId,
          serviceLinkSource: 'suggested',
        })
        .where(eq(leadForm.id, existing.id));
      logger.info('Suggested service for existing lead form', {
        leadFormId: existing.id,
        organizationId,
        serviceId: suggestion.serviceId,
        suggestionScore: suggestion.score,
      });
    }
  } catch (error) {
    // Non-critical — never fail webhook processing because of form sync.
    logError('leadForms.ensureLeadFormSynced', error, {
      feature: 'lead-forms',
      extra: { metaFormId, organizationId },
    });
  }
}
