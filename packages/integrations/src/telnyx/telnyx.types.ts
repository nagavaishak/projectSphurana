/**
 * Telnyx API Types
 *
 * Types for Telnyx phone number provisioning API.
 * @see https://developers.telnyx.com/api/numbers
 */

// ============================================================================
// Available Numbers
// ============================================================================

export interface TelnyxAvailableNumber {
  phone_number: string;
  region_information: Array<{
    region_name: string;
    region_type: string;
  }>;
  cost_information: {
    upfront_cost: string;
    monthly_cost: string;
    currency: string;
  };
  features: Array<{
    name: string;
  }>;
  record_type: string;
}

export interface TelnyxSearchAvailableNumbersResponse {
  data: TelnyxAvailableNumber[];
  metadata: {
    total_results: number;
    best_effort: boolean;
  };
}

export interface TelnyxSearchOptions {
  countryCode: string;
  city?: string;
  state?: string;
  areaCode?: string;
  limit?: number;
}

// ============================================================================
// Number Orders
// ============================================================================

export interface TelnyxNumberOrder {
  id: string;
  phone_numbers: Array<{
    id: string;
    phone_number: string;
    record_type: string;
    status: string;
  }>;
  status: string;
  record_type: string;
  created_at: string;
  updated_at: string;
}

export interface TelnyxNumberOrderResponse {
  data: TelnyxNumberOrder;
}

// ============================================================================
// Phone Number Management
// ============================================================================

export interface TelnyxPhoneNumber {
  id: string;
  phone_number: string;
  status: string;
  connection_id: string | null;
  record_type: string;
  created_at: string;
  updated_at: string;
}

export interface TelnyxPhoneNumberResponse {
  data: TelnyxPhoneNumber;
}
