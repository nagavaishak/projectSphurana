import type { LeadForm } from '@/features/lead-forms/api/types';
import { leadFormFieldTypeLabels } from '@/features/lead-forms/api/types';
import type { MetaErrorDetail } from '@borradh-workspace/api-client';

export async function extractMetaErrorFromResponse(
  error: unknown
): Promise<MetaErrorDetail | undefined> {
  if (
    !error ||
    typeof error !== 'object' ||
    !('response' in error) ||
    !(error as Record<string, unknown>).response
  ) {
    return undefined;
  }

  try {
    const response = (error as { response: Response }).response;
    const body = (await response.clone().json()) as Record<string, unknown>;
    const details = body.details as Record<string, unknown> | undefined;
    if (details?.metaError && typeof details.metaError === 'object') {
      return details.metaError as MetaErrorDetail;
    }
  } catch {
    // Response not JSON or already consumed
  }

  return undefined;
}

export function getCurrencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

export function getLeadFormFieldsPreview(form: LeadForm): string {
  return form.questions
    .map((q) => q.label?.trim() || leadFormFieldTypeLabels[q.type])
    .join(', ');
}
