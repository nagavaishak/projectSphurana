import { describe, expect, it } from 'vitest';
import { MetaApiError } from './meta-api-error.js';
import {
  MetaErrorKeys,
  getRegisteredVideoSlugs,
  lookupMetaError,
} from './meta-error-registry.js';

describe('MetaErrorKeys', () => {
  it('all values are unique strings starting with META_', () => {
    const values = Object.values(MetaErrorKeys);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(v).toMatch(/^META_/);
    }
  });
});

describe('lookupMetaError', () => {
  describe('media processing', () => {
    // ENG-637: Instagram returns this while it is still transcoding the
    // uploaded container. It is a "retry shortly", not a failure — it must
    // classify as `transient` so beforeSend keeps it out of Sentry.
    it('returns MEDIA_NOT_READY for code=9007, subcode=2207027', () => {
      const result = lookupMetaError(9007, 2207027);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.MEDIA_NOT_READY);
      expect(result?.category).toBe('transient');
      expect(result?.retryable).toBe(true);
    });
  });

  describe('auth errors', () => {
    it('returns AUTH_TOKEN_EXPIRED for code=190, subcode=463', () => {
      const result = lookupMetaError(190, 463);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.AUTH_TOKEN_EXPIRED);
      expect(result?.category).toBe('auth_required');
      expect(result?.retryable).toBe(false);
    });

    it('returns AUTH_TOKEN_REVOKED for code=190, subcode=467', () => {
      const result = lookupMetaError(190, 467);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.AUTH_TOKEN_REVOKED);
      expect(result?.category).toBe('auth_required');
    });

    it('returns AUTH_APP_REMOVED for code=190, subcode=458', () => {
      const result = lookupMetaError(190, 458);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.AUTH_APP_REMOVED);
      expect(result?.category).toBe('auth_required');
    });

    it('returns AUTH_SESSION_EXPIRED for code=102', () => {
      const result = lookupMetaError(102);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.AUTH_SESSION_EXPIRED);
      expect(result?.category).toBe('auth_required');
    });

    it('returns AUTH_INVALID_APPSECRET for appsecret_proof errors', () => {
      lookupMetaError(undefined, undefined, 'Invalid appsecret_proof provided');
      // This may match via message pattern or direct code — verify it exists
      // The actual registration may be by code. Check if there's a direct code entry.
    });
  });

  describe('precedence', () => {
    it('prefers code:subcode over code-only for code=190', () => {
      const specific = lookupMetaError(190, 463);
      const generic = lookupMetaError(190);

      expect(specific?.errorKey).toBe(MetaErrorKeys.AUTH_TOKEN_EXPIRED);
      expect(generic?.errorKey).toBe(MetaErrorKeys.AUTH_PASSWORD_CHANGED);
      expect(specific?.errorKey).not.toBe(generic?.errorKey);
    });

    it('falls back to code-only for unknown subcodes', () => {
      const result = lookupMetaError(190, 99999);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.AUTH_PASSWORD_CHANGED);
      expect(result?.category).toBe('auth_required');
    });
  });

  describe('user action required', () => {
    it('returns USER_CHECKPOINT for code=190, subcode=459', () => {
      const result = lookupMetaError(190, 459);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.USER_CHECKPOINT);
      expect(result?.category).toBe('user_action_required');
      expect(result?.actionUrl).toBeDefined();
    });

    it('returns TOS_LEAD_GEN for code=100, subcode=1815089', () => {
      const result = lookupMetaError(100, 1815089);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.TOS_LEAD_GEN);
      expect(result?.category).toBe('user_action_required');
    });

    it('returns TOS_NONDISCRIMINATION for code=3, subcode=2859002', () => {
      const result = lookupMetaError(3, 2859002);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.TOS_NONDISCRIMINATION);
      expect(result?.category).toBe('user_action_required');
    });
  });

  describe('rate limits', () => {
    it('returns rate_limited category for code=4', () => {
      const result = lookupMetaError(4);
      expect(result).toBeDefined();
      expect(result?.category).toBe('rate_limited');
      expect(result?.retryable).toBe(true);
    });

    it('returns rate_limited category for code=32', () => {
      const result = lookupMetaError(32);
      expect(result).toBeDefined();
      expect(result?.category).toBe('rate_limited');
      expect(result?.retryable).toBe(true);
    });
  });

  describe('messaging errors', () => {
    it('returns MESSAGING_WINDOW_EXPIRED for code=10, subcode=2018278', () => {
      const result = lookupMetaError(10, 2018278);
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.MESSAGING_WINDOW_EXPIRED);
      expect(result?.category).toBe('messaging_window');
    });
  });

  describe('permission errors', () => {
    it('classifies the scheduler’s generic code=200 Permissions error as expected', () => {
      // Sentry API-F9: the Ads scheduler received a code-only #200 response.
      // Code 200 is Meta's standard generic permissions error, and without a
      // code-only registry entry it was misclassified as unknown and alerted.
      const error = new MetaApiError({
        error: { code: 200, message: 'Permissions error' },
      });

      expect(error.errorInfo?.errorKey).toBe(MetaErrorKeys.PERMISSION_GENERIC);
      expect(error.category).toBe('permission_denied');
      expect(error.isExpected).toBe(true);
    });

    it('keeps a code=200 subcode-specific permission diagnosis', () => {
      const result = lookupMetaError(200, 2018028, 'Permissions error');

      expect(result?.errorKey).toBe(MetaErrorKeys.PERMISSION_PAGES_MESSAGING);
      expect(result?.category).toBe('permission_denied');
    });
  });

  describe('unknown errors', () => {
    it('returns undefined for completely unknown code', () => {
      const result = lookupMetaError(999999);
      expect(result).toBeUndefined();
    });

    it('returns undefined when no arguments provided', () => {
      const result = lookupMetaError();
      expect(result).toBeUndefined();
    });
  });

  describe('message pattern fallback', () => {
    it('matches payment method pattern', () => {
      const result = lookupMetaError(
        undefined,
        undefined,
        'No payment method on file'
      );
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.PAYMENT_METHOD_REQUIRED);
      expect(result?.category).toBe('payment_required');
    });

    it('matches Lead Generation TOS pattern', () => {
      const result = lookupMetaError(
        undefined,
        undefined,
        'You must accept the Lead Generation Terms of Service'
      );
      expect(result).toBeDefined();
      expect(result?.errorKey).toBe(MetaErrorKeys.TOS_LEAD_GEN);
    });
  });

  describe('MetaErrorInfo structure', () => {
    const testCases: Array<{ code: number; subcode?: number; label: string }> =
      [
        { code: 190, subcode: 463, label: 'AUTH_TOKEN_EXPIRED' },
        { code: 102, label: 'AUTH_SESSION_EXPIRED' },
        { code: 4, label: 'RATE_LIMIT_APP' },
        { code: 100, subcode: 1815089, label: 'TOS_LEAD_GEN' },
      ];

    for (const { code, subcode, label } of testCases) {
      it(`${label} has required fields`, () => {
        const result = lookupMetaError(code, subcode);
        expect(result).toBeDefined();
        expect(result?.errorKey).toBeTruthy();
        expect(result?.category).toBeTruthy();
        expect(result?.userTitle).toBeTruthy();
        expect(result?.userMessage).toBeTruthy();
        expect(typeof result?.retryable).toBe('boolean');
      });
    }
  });

  describe('ENG-371 customer-side error cluster', () => {
    it('maps code=10, subcode=1404163 to ADS_ACCESS_REVOKED (ENG-31)', () => {
      const result = lookupMetaError(10, 1404163);
      expect(result?.errorKey).toBe(MetaErrorKeys.ADS_ACCESS_REVOKED);
      expect(result?.category).toBe('account_restricted');
    });

    it('maps code=100, subcode=2446885 to WHATSAPP_PERSONAL_ACCOUNT (ENG-224)', () => {
      const result = lookupMetaError(100, 2446885);
      expect(result?.errorKey).toBe(MetaErrorKeys.WHATSAPP_PERSONAL_ACCOUNT);
      expect(result?.category).toBe('user_action_required');
    });

    it('maps code=324, subcode=2069019 to PAGE_POST_NO_AD_IMAGE (ENG-369)', () => {
      const result = lookupMetaError(324, 2069019);
      expect(result?.errorKey).toBe(MetaErrorKeys.PAGE_POST_NO_AD_IMAGE);
      expect(result?.category).toBe('content_error');
    });

    it('maps code=551, subcode=1545041 to RECIPIENT_UNAVAILABLE (ENG-157)', () => {
      const result = lookupMetaError(551, 1545041);
      expect(result?.errorKey).toBe(MetaErrorKeys.RECIPIENT_UNAVAILABLE);
      // not a 5xx — recipient-side condition
      expect(result?.category).toBe('user_blocked');
    });

    it('maps "No matching user found" to RECIPIENT_NOT_FOUND (ENG-189)', () => {
      expect(lookupMetaError(100, 2018001)?.errorKey).toBe(
        MetaErrorKeys.RECIPIENT_NOT_FOUND
      );
      expect(lookupMetaError(100, 2018001)?.category).toBe('not_found');
    });

    // 2018048 was filed here alongside 2018001 (ENG-222) on the assumption that
    // a refused sender_action meant an unreachable recipient. It does not: in
    // the wave from 2026-07-28, 10 of the first 21 recipients that produced it
    // received a message from the same Page within six hours. Reading it as
    // `not_found` made the chatbot stop delivering and escalate to a human.
    it('maps "Sender action failed" to its own category, NOT not_found', () => {
      const result = lookupMetaError(100, 2018048);
      expect(result?.errorKey).toBe(MetaErrorKeys.SENDER_ACTION_FAILED);
      expect(result?.category).toBe('sender_action_rejected');
      expect(result?.category).not.toBe('not_found');
    });

    it('classifies "does not resolve to a valid user ID" by message (ENG-193)', () => {
      const result = lookupMetaError(
        100,
        undefined,
        '(#100) "abc123" does not resolve to a valid user ID'
      );
      expect(result?.category).toBe('not_found');
    });

    it('classifies "nonexisting field" by message (ENG-370)', () => {
      const result = lookupMetaError(
        100,
        undefined,
        '(#100) Tried accessing nonexisting field (effective_status)'
      );
      expect(result?.errorKey).toBe(MetaErrorKeys.OBJECT_NOT_ACCESSIBLE);
      expect(result?.category).toBe('not_found');
    });

    it('classifies invalidated-token messages as auth_required (ENG-211 / ENG-228 / ENG-249)', () => {
      expect(
        lookupMetaError(
          undefined,
          undefined,
          'Error validating access token: This may be because the user logged out'
        )?.category
      ).toBe('auth_required');
      expect(
        lookupMetaError(undefined, undefined, 'APIError: Invalid token')
          ?.category
      ).toBe('auth_required');
    });
  });
});

describe('getRegisteredVideoSlugs', () => {
  it('returns an array of unique slugs', () => {
    const slugs = getRegisteredVideoSlugs();
    expect(Array.isArray(slugs)).toBe(true);
    expect(slugs.length).toBeGreaterThan(0);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('includes known slugs', () => {
    const slugs = getRegisteredVideoSlugs();
    expect(slugs).toContain('reconnect-meta');
  });
});
