import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type {
  AvailableSmsNumber,
  SmsNumberProvider,
} from '../_shared/sms-number-provider.js';
import {
  type SearchSmsNumbersInput,
  searchSmsNumbersSchema,
} from './search-sms-numbers.schema.js';

/**
 * Search purchasable local SMS numbers for a country (read-only, no cost).
 * Backs the "pick a number" step before the paid provision call.
 */
const searchSmsNumbersImpl = async (
  input: SearchSmsNumbersInput,
  provider: SmsNumberProvider
): Promise<Result<AvailableSmsNumber[]>> => {
  const parsed = searchSmsNumbersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const numbers = await provider.listAvailableNumbers(parsed.data.country, {
      areaCode: parsed.data.areaCode,
      limit: parsed.data.limit,
    });
    return ok(numbers);
  } catch (error) {
    logError('campaigns.searchSmsNumbers', error, {
      feature: 'campaigns',
      extra: {
        organizationId: parsed.data.organizationId,
        country: parsed.data.country,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error
          ? `Could not search for numbers: ${error.message}`
          : 'Could not search for numbers'
      )
    );
  }
};

export const searchSmsNumbers = (
  input: SearchSmsNumbersInput,
  provider: SmsNumberProvider
) =>
  trackedResult(
    'campaigns.searchSmsNumbers',
    () => searchSmsNumbersImpl(input, provider),
    { properties: { organizationId: input.organizationId } }
  );

export type SearchSmsNumbersResult = Awaited<
  ReturnType<typeof searchSmsNumbers>
>;
