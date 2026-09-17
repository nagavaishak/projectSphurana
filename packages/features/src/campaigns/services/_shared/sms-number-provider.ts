/**
 * The SMS-number provisioning provider the campaign services dispatch through.
 *
 * Dependency-injected at the API edge (the controller builds the real Twilio
 * implementation, tests pass a dry-run/fake), so the feature services stay
 * decoupled from the provider SDK and unit-testable without spending money.
 *
 * `TwilioSMSService` (packages/integrations) structurally satisfies this.
 */

export interface AvailableSmsNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
}

export interface ProvisionedSmsNumber {
  sid: string;
  phoneNumber: string;
}

export interface SmsNumberProvider {
  /** Read-only search for purchasable local numbers (no cost). */
  listAvailableNumbers(
    country: string,
    opts?: { areaCode?: string; limit?: number }
  ): Promise<AvailableSmsNumber[]>;

  /** Numbers this account already owns (no cost). */
  listOwnedNumbers(): Promise<ProvisionedSmsNumber[]>;

  /** Purchase a number — COSTS MONEY. Gate behind explicit confirmation. */
  provisionNumber(opts: {
    phoneNumber: string;
    friendlyName?: string;
    smsWebhookUrl?: string;
  }): Promise<ProvisionedSmsNumber>;
}
