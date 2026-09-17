/**
 * Common integration types
 */

export type IntegrationType =
  | 'facebook_leads'
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'voice';

export interface IntegrationConfig {
  type: IntegrationType;
  isActive: boolean;
  credentials: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface IntegrationClient {
  test(): Promise<boolean>;
  disconnect(): Promise<void>;
}
