/**
 * Named request-body shapes for the integrations entry points.
 *
 * These are INTERFACES, not `createZodDto` classes, and that is deliberate.
 * The app installs a global `ZodValidationPipe`, which validates only when the
 * parameter's metatype is a Zod DTO. An interface erases at compile time, so
 * naming these shapes changes nothing at runtime — the bodies reach the use
 * cases exactly as they did when the shapes were written inline, and the use
 * cases' own Zod schemas remain the only validation, exactly as before.
 *
 * Their purpose is the other half of the thinness rule: input shaping belongs
 * in the parameter, not the body. A ten-line object literal in a signature is
 * still logic a reader has to parse before reaching the one line that matters.
 */

export interface WhatsappFinalizeBody {
  code: string;
  wabaId: string;
}

export interface CreateWhatsappTemplateBody {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  body: string;
  headerText?: string;
  footerText?: string;
}

export interface MetaAdsConnectBody {
  code: string;
  adAccountId: string;
  adAccountName?: string;
  pageId: string;
  pageName?: string;
  pixelId?: string;
  pixelName?: string;
}

export interface ConfigureMetaAdsBody {
  integrationId: string;
  adAccountIds: string[];
  pageIds: string[];
}

export interface AddMetaAdsPageBody {
  pageAccessToken: string;
  pageId: string;
  pageName?: string;
  platform: 'facebook' | 'instagram';
  pixelId?: string;
  pixelName?: string;
  setAsDefault?: boolean;
}

export interface CreateMetaLeadFormBody {
  name: string;
  questions: Array<{
    type: string;
    label?: string;
    key?: string;
    options?: Array<{ value: string; key?: string }>;
  }>;
  /** Optional — the service falls back to the org website / Facebook Page. */
  privacyPolicyUrl?: string;
  thankYouPage?: {
    title?: string;
    body?: string;
    buttonText?: string;
    buttonUrl?: string;
  };
}

export interface PhorestConnectBody {
  username: string;
  password: string;
  businessId: string;
  region?: 'eu' | 'us';
}

export interface MetaAdsInitiateBody {
  code: string;
}
