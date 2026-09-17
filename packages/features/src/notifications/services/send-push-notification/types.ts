export interface DispatchInput {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  userId: string;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  // Tokens the provider reported as permanently invalid (e.g. uninstalled
  // app, expired registration). The caller deletes these from the DB.
  invalidTokens: string[];
  // Set when the dispatcher could not even attempt delivery because the
  // provider is not configured (credentials missing/unparseable). Distinct
  // from per-token failures: nothing is wrong with the tokens, and no amount
  // of retrying will help until ops sets the secrets. Surfaced in the error
  // the service returns so the cause is visible without reading warn logs.
  configError?: string;
}
