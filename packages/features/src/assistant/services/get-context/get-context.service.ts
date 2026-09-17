import {
  and,
  eq,
  organization,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { businessTypeLabels } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetContextInput,
  getContextSchema,
} from './get-context.schema.js';

export interface OrgServiceDetail {
  name: string;
  painPoints: string[] | null;
  expectedResults: string[] | null;
  processDescription: string | null;
  targetArea: string | null;
}

export interface AssistantContext {
  name: string;
  address: string | null;
  /**
   * IANA timezone the business operates in (e.g. "Europe/Dublin"), from
   * `organization.timezone`. The single time source for Claire's date
   * resolution (Phase 3) — the advisory "Today is…" prompt line and every
   * date-bearing tool resolve relative expressions in this zone. Never the
   * user's timezone: a business runs in one zone regardless of who is looking.
   */
  timezone: string;
  businessType: string;
  businessTypeLabel: string;
  brandVoice: string[];
  targetAudienceDescription: string | null;
  credibilityLine: string | null;
  tagline: string | null;
  services: string[];
  serviceDetails: OrgServiceDetail[];
}

const getContextImpl = async (
  db: DbConnection,
  input: GetContextInput
): Promise<Result<AssistantContext>> => {
  const parsed = getContextSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const { org, resolvedServices } = await withOrgScope(
      async (tx) => {
        const org = await tx.query.organization.findFirst({
          where: and(
            eq(organization.id, organizationId),
            notDeleted(organization)
          ),
          columns: {
            name: true,
            businessType: true,
            brandVoice: true,
            targetAudienceDescription: true,
            credibilityLine: true,
            tagline: true,
            address: true,
            timezone: true,
          },
        });
        const resolvedServices = await tx
          .select({
            name: organizationService.name,
            painPoints: organizationService.painPoints,
            expectedResults: organizationService.expectedResults,
            processDescription: organizationService.processDescription,
            targetArea: organizationService.targetArea,
          })
          .from(organizationService)
          .where(eq(organizationService.organizationId, organizationId));
        return { org, resolvedServices };
      },
      { db }
    );

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    const businessType = org.businessType as string;
    const businessTypeLabel =
      businessTypeLabels[businessType as keyof typeof businessTypeLabels] ??
      businessType;

    return ok({
      name: org.name,
      address: org.address,
      timezone: org.timezone,
      businessType,
      businessTypeLabel,
      brandVoice: (org.brandVoice as string[]) || [],
      targetAudienceDescription: org.targetAudienceDescription,
      credibilityLine: org.credibilityLine,
      tagline: org.tagline,
      services: resolvedServices.map((s) => s.name),
      serviceDetails: resolvedServices.map((s) => ({
        name: s.name,
        painPoints: s.painPoints as string[] | null,
        expectedResults: s.expectedResults as string[] | null,
        processDescription: s.processDescription,
        targetArea: s.targetArea,
      })),
    });
  } catch (error) {
    logError('assistant.getContext', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load assistant context'
      )
    );
  }
};

export const getAssistantContext = (db: DbConnection, input: GetContextInput) =>
  trackedResult('assistant.getContext', () => getContextImpl(db, input), {
    properties: { organizationId: input.organizationId },
    internalErrorsOnly: true,
  });
