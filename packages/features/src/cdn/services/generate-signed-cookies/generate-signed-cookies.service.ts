import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  SignedCookiesResult as CloudFrontCookies,
  generateSignedCookies as GenerateSignedCookiesFn,
  getCdnUrl as GetCdnUrlFn,
  isCdnEnabled as IsCdnEnabledFn,
} from '@borradh-workspace/storage';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GenerateSignedCookiesInput,
  generateSignedCookiesSchema,
} from './generate-signed-cookies.schema.js';

export interface CdnDeps {
  isCdnEnabled: typeof IsCdnEnabledFn;
  getCdnUrl: typeof GetCdnUrlFn;
  generateSignedCookies: typeof GenerateSignedCookiesFn;
}

export interface SignedCookiesResult {
  cookies: CloudFrontCookies;
  domain: string | undefined;
  expiresIn: number;
  cdnUrl: string;
  organizationId: string;
  isProduction: boolean;
}

const generateSignedCookiesImpl = async (
  cdnDeps: CdnDeps,
  input: GenerateSignedCookiesInput,
  isProduction: boolean
): Promise<Result<SignedCookiesResult>> => {
  const parsed = generateSignedCookiesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  if (!cdnDeps.isCdnEnabled()) {
    // NOT_CONFIGURED, not FORBIDDEN: the caller is permitted, the CDN is
    // simply switched off on this deployment. FORBIDDEN means 403 everywhere
    // else, and this condition is served as a 503.
    return err(
      new FeatureError(ErrorCodes.NOT_CONFIGURED, 'CDN is not enabled')
    );
  }

  const cdnUrl = cdnDeps.getCdnUrl();
  if (!cdnUrl) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'CDN URL not configured')
    );
  }

  try {
    const expiresIn = 3600; // 1 hour

    const cookies = cdnDeps.generateSignedCookies({
      organizationId,
      expiresIn,
    });

    // Extract domain for cookie
    const cdnHostname = new URL(cdnUrl).hostname;
    const cookieDomain = isProduction
      ? `.${cdnHostname.split('.').slice(-2).join('.')}`
      : undefined;

    return ok({
      cookies,
      domain: cookieDomain,
      expiresIn,
      cdnUrl,
      organizationId,
      isProduction,
    });
  } catch (error) {
    logError('cdn.generateSignedCookies', error, {
      feature: 'cdn',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate CDN access credentials'
      )
    );
  }
};

export const generateCdnSignedCookies = (
  cdnDeps: CdnDeps,
  input: GenerateSignedCookiesInput,
  isProduction: boolean
) =>
  trackedResult(
    'cdn.generateSignedCookies',
    () => generateSignedCookiesImpl(cdnDeps, input, isProduction),
    {
      properties: { organizationId: input.organizationId },
    }
  );
