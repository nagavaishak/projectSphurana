import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger, logError } from '@borradh-workspace/observability';

const logger = createLogger('ExchangeRates');

export interface ExchangeRates {
  /** Rates relative to USD. E.g. { EUR: 0.923, GBP: 0.791 } means 1 USD = 0.923 EUR */
  rates: Record<string, number>;
  fetchedAt: Date;
}

let cachedRates: ExchangeRates | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch daily exchange rates from ECB via frankfurter.app.
 * Free API, no API key required. Rates update once per business day.
 *
 * Caches in memory for 24 hours (sufficient for daily sync).
 *
 * @returns Exchange rates relative to USD, or null if fetch fails.
 */
export async function getExchangeRates(): Promise<ExchangeRates | null> {
  // Return cached if still fresh
  if (
    cachedRates &&
    Date.now() - cachedRates.fetchedAt.getTime() < CACHE_TTL_MS
  ) {
    return cachedRates;
  }

  try {
    const response = await fetchWithRetry(
      'https://api.frankfurter.app/latest?from=USD'
    );

    if (!response.ok) {
      logger.warn('Failed to fetch exchange rates', {
        status: response.status,
      });
      return cachedRates; // Return stale cache if available
    }

    const data = (await response.json()) as {
      rates: Record<string, number>;
    };

    cachedRates = {
      rates: { ...data.rates, USD: 1 }, // Add USD = 1 for completeness
      fetchedAt: new Date(),
    };

    logger.info('Exchange rates updated', {
      currencies: Object.keys(cachedRates.rates).length,
    });

    return cachedRates;
  } catch (error) {
    logError('exchangeRates.fetch', error, {
      feature: 'shared',
    });
    return cachedRates; // Return stale cache if available
  }
}

/**
 * Convert an amount from a source currency to USD cents.
 *
 * @param amountCents - Amount in cents of the source currency
 * @param currency - Source currency code (e.g. 'EUR', 'GBP')
 * @param rates - Exchange rates from getExchangeRates()
 * @returns Amount in USD cents, or null if conversion not possible
 */
export function convertToUsdCents(
  amountCents: number,
  currency: string,
  rates: ExchangeRates
): { usdCents: number; rateUsed: string } | null {
  const upperCurrency = currency.toUpperCase();

  if (upperCurrency === 'USD') {
    return { usdCents: amountCents, rateUsed: '1' };
  }

  const rate = rates.rates[upperCurrency];
  if (!rate) {
    logger.warn('No exchange rate found for currency', { currency });
    return null;
  }

  // rate is "1 USD = X currency", so to convert currency to USD: amount / rate
  const usdCents = Math.round(amountCents / rate);
  return { usdCents, rateUsed: rate.toFixed(6) };
}
