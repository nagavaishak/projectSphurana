import type { PhoneNumber } from '@borradh-workspace/database';

/**
 * Selected phone number for an outbound call
 */
export interface SelectedPhoneNumber {
  phoneNumberId: string;
  number: string;
}

/**
 * Phone number list response with plan usage info
 */
export interface PhoneNumberListResult {
  items: PhoneNumber[];
  maxAllowed: number;
  currentCount: number;
}
