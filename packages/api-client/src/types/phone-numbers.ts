/**
 * @borradh-workspace/api-client - Phone Number Types
 *
 * Derived from database labels (source of truth) per type-sharing pattern.
 */

import type { BuyPhoneNumberInput as BackendBuyPhoneNumberInput } from '@borradh-workspace/features/phone-numbers';
import type { AddPhoneNumberInput as BackendAddPhoneNumberInput } from '@borradh-workspace/features/phone-numbers';
import type { SearchAvailableNumbersInput as BackendSearchAvailableNumbersInput } from '@borradh-workspace/features/phone-numbers';
import type {
  PhoneNumber as BackendPhoneNumber,
  PhoneNumberProvider,
  PhoneNumberStatus,
} from '@borradh-workspace/features/shared';
import {
  phoneNumberProviderLabels,
  phoneNumberProviderValues,
  phoneNumberStatusLabels,
  phoneNumberStatusValues,
} from '@borradh-workspace/features/shared';
import type { Serialize } from './serialization.js';

// Re-export enum types from features/shared
export type { PhoneNumberStatus, PhoneNumberProvider };

// Re-export labels and values for frontend use
export {
  phoneNumberStatusLabels,
  phoneNumberStatusValues,
  phoneNumberProviderLabels,
  phoneNumberProviderValues,
};

// Serialized entity (Date → string)
export type PhoneNumber = Serialize<BackendPhoneNumber>;

// Input types (omit server-side fields)
export type BuyPhoneNumberInput = Omit<
  BackendBuyPhoneNumberInput,
  'organizationId'
>;

export type AddPhoneNumberInput = Omit<
  BackendAddPhoneNumberInput,
  'organizationId'
>;

export type SearchAvailableNumbersInput = BackendSearchAvailableNumbersInput;

// List response
export interface PhoneNumberListResponse {
  items: PhoneNumber[];
  maxAllowed: number;
  currentCount: number;
}

// Available number from Telnyx search
export interface AvailableNumber {
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
}

export interface AvailableNumbersResponse {
  items: AvailableNumber[];
}
