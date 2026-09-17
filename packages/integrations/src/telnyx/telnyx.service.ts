/**
 * Telnyx Phone Number Provisioning Service
 *
 * Raw fetch wrapper for Telnyx API v2.
 * Handles searching, buying, and releasing phone numbers.
 *
 * @see https://developers.telnyx.com/api/numbers
 */

import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import type {
  TelnyxAvailableNumber,
  TelnyxNumberOrder,
  TelnyxNumberOrderResponse,
  TelnyxPhoneNumber,
  TelnyxPhoneNumberResponse,
  TelnyxSearchAvailableNumbersResponse,
  TelnyxSearchOptions,
} from './telnyx.types.js';

const TELNYX_API_BASE = 'https://api.telnyx.com';

export class TelnyxService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ============================================================================
  // HTTP Helper
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${TELNYX_API_BASE}${path}`;

    const fetchOpts = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 15000,
    };

    // GET is a read (safe to retry); POST/DELETE mutate (timeout only).
    const response =
      method === 'GET'
        ? await fetchWithRetry(url, fetchOpts)
        : await fetchWithTimeout(url, fetchOpts);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Telnyx API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // Available Numbers
  // ============================================================================

  /**
   * Search for available phone numbers to purchase
   */
  async searchAvailableNumbers(
    options: TelnyxSearchOptions
  ): Promise<TelnyxAvailableNumber[]> {
    const params = new URLSearchParams();
    params.set('filter[country_code]', options.countryCode);
    params.set('filter[phone_number_type]', 'local');
    params.set('filter[limit]', String(options.limit ?? 10));

    if (options.city) {
      params.set('filter[locality]', options.city);
    }
    if (options.state) {
      params.set('filter[administrative_area]', options.state);
    }
    if (options.areaCode) {
      params.set('filter[national_destination_code]', options.areaCode);
    }

    const result = await this.request<TelnyxSearchAvailableNumbersResponse>(
      'GET',
      `/v2/available_phone_numbers?${params.toString()}`
    );

    return result.data;
  }

  // ============================================================================
  // Number Orders
  // ============================================================================

  /**
   * Purchase a phone number
   */
  async buyNumber(
    phoneNumber: string,
    connectionId?: string
  ): Promise<TelnyxNumberOrder> {
    const result = await this.request<TelnyxNumberOrderResponse>(
      'POST',
      '/v2/number_orders',
      {
        phone_numbers: [{ phone_number: phoneNumber }],
        ...(connectionId ? { connection_id: connectionId } : {}),
      }
    );

    return result.data;
  }

  // ============================================================================
  // Phone Number Management
  // ============================================================================

  /**
   * Get a phone number by its Telnyx ID
   */
  async getNumber(numberId: string): Promise<TelnyxPhoneNumber> {
    const result = await this.request<TelnyxPhoneNumberResponse>(
      'GET',
      `/v2/phone_numbers/${numberId}`
    );

    return result.data;
  }

  /**
   * Release (delete) a phone number
   */
  async releaseNumber(numberId: string): Promise<void> {
    await this.request<void>('DELETE', `/v2/phone_numbers/${numberId}`);
  }
}

/**
 * Create a TelnyxService instance
 */
export function createTelnyxService(apiKey: string): TelnyxService {
  return new TelnyxService(apiKey);
}
