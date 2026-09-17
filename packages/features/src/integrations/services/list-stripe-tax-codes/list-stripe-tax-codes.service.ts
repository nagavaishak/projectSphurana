import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListStripeTaxCodesInput,
  listStripeTaxCodesSchema,
} from './list-stripe-tax-codes.schema.js';

export interface StripeTaxCodeOption {
  id: string;
  name: string;
  description: string;
}

const CACHE_KEY = 'stripe:tax-codes:v1';
/** Stripe owns this slowly-changing catalogue; a day avoids a Stripe call per editor open. */
export const STRIPE_TAX_CODES_CACHE_TTL_SECONDS = 60 * 60 * 24;

const readCache = async (): Promise<StripeTaxCodeOption[] | null> => {
  try {
    const raw = await getRedis().get(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item): item is StripeTaxCodeOption =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StripeTaxCodeOption).id === 'string' &&
        typeof (item as StripeTaxCodeOption).name === 'string' &&
        typeof (item as StripeTaxCodeOption).description === 'string'
    );
  } catch {
    // A cache outage should make this one Stripe request slower, not prevent a
    // staff member from editing a product or service.
    return null;
  }
};

const writeCache = async (options: StripeTaxCodeOption[]): Promise<void> => {
  try {
    await getRedis().set(
      CACHE_KEY,
      JSON.stringify(options),
      'EX',
      STRIPE_TAX_CODES_CACHE_TTL_SECONDS
    );
  } catch {
    // Same graceful degradation as cache reads.
  }
};

const listStripeTaxCodesImpl = async (
  input: ListStripeTaxCodesInput
): Promise<Result<StripeTaxCodeOption[]>> => {
  const parsed = listStripeTaxCodesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const cached = await readCache();
  if (cached) return ok(cached);

  try {
    const options = await getStripeConnectService().listTaxCodes();
    await writeCache(options);
    return ok(options);
  } catch (error) {
    logError('integrations.listStripeTaxCodes', error, {
      feature: 'integrations',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Could not load Stripe tax codes. Please try again.'
      )
    );
  }
};

export const listStripeTaxCodes = (input: ListStripeTaxCodesInput) =>
  trackedResult(
    'integrations.listStripeTaxCodes',
    () => listStripeTaxCodesImpl(input),
    { properties: { organizationId: input.organizationId } }
  );

export type ListStripeTaxCodesResult = Awaited<
  ReturnType<typeof listStripeTaxCodes>
>;
