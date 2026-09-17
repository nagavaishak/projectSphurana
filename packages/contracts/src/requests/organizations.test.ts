import { describe, expect, it } from 'vitest';
import {
  createAccountLinkRequestSchema,
  linkStripeAccountRequestSchema,
  toggleInstagramChatbotRequestSchema,
  updateChatbotSettingsRequestSchema,
  updateOrganizationSettingsRequestSchema,
  updateUserRequestSchema,
} from './organizations.js';

describe('updateOrganizationSettingsRequestSchema', () => {
  it('accepts an empty body (a PATCH that changes nothing)', () => {
    expect(updateOrganizationSettingsRequestSchema.safeParse({}).success).toBe(
      true
    );
  });

  it('accepts a partial body — each settings screen patches only its own keys', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        name: 'Glow Clinic',
        primaryColor: '#ff0088',
        depositEnabled: true,
        depositAmount: 2500,
      }).success
    ).toBe(true);
  });

  it('REJECTS the server-injected `organizationId` (proves .strict())', () => {
    const result = updateOrganizationSettingsRequestSchema.safeParse({
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('REJECTS the legacy `primaryCalendarType` — ENG-500 made it server-derived', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        primaryCalendarType: 'borradh',
      }).success
    ).toBe(false);
  });

  it('rejects a blank string for a URL field (the "cleared" value is null)', () => {
    // This is the bug the contract MOVES rather than hides: a settings input
    // whose empty value is `''` must be normalised to `null`/`undefined` in the
    // payload builder, or it now fails client-side instead of 400-ing.
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({ websiteUrl: '' })
        .success
    ).toBe(false);
  });

  it('accepts `null` to CLEAR a nullable link field', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        defaultBookingLink: null,
      }).success
    ).toBe(true);
  });

  it('rejects a malformed hex colour', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        primaryColor: 'hot pink',
      }).success
    ).toBe(false);
  });

  it('rejects a fractional `depositAmount` (minor units are integers)', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({ depositAmount: 25.5 })
        .success
    ).toBe(false);
  });

  it('rejects a bookingDestination outside the shared labels vocabulary', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        bookingDestination: 'carrier_pigeon',
      }).success
    ).toBe(false);
  });

  it('parses wire business hours (string day keys) into numeric day keys', () => {
    const parsed = updateOrganizationSettingsRequestSchema.parse({
      businessHours: { '1': { from: 540, to: 1020 } },
    });
    expect(parsed.businessHours).toEqual({ 1: { from: 540, to: 1020 } });
  });

  it('rejects a day index outside 0–6', () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        businessHours: { '7': { from: 540, to: 1020 } },
      }).success
    ).toBe(false);
  });
});

describe('updateChatbotSettingsRequestSchema', () => {
  it('accepts a partial chatbot profile', () => {
    expect(
      updateChatbotSettingsRequestSchema.safeParse({
        chatbotSettings: {
          tone: 'warm',
          faqs: [{ question: 'Do you park?', answer: 'Free on-site parking.' }],
        },
      }).success
    ).toBe(true);
  });

  it('rejects an FAQ with a question but no answer', () => {
    expect(
      updateChatbotSettingsRequestSchema.safeParse({
        chatbotSettings: { faqs: [{ question: 'Do you park?', answer: '' }] },
      }).success
    ).toBe(false);
  });

  it('rejects a malformed clinic email', () => {
    expect(
      updateChatbotSettingsRequestSchema.safeParse({
        chatbotSettings: { clinicEmail: 'not-an-email' },
      }).success
    ).toBe(false);
  });

  it('accepts an opaque `knowledgeBase` blob', () => {
    expect(
      updateChatbotSettingsRequestSchema.safeParse({
        knowledgeBase: { anything: ['at', 'all'] },
      }).success
    ).toBe(true);
  });

  it('REJECTS the server-injected `organizationId`', () => {
    expect(
      updateChatbotSettingsRequestSchema.safeParse({ organizationId: 'org_1' })
        .success
    ).toBe(false);
  });
});

describe('toggleInstagramChatbotRequestSchema', () => {
  it('accepts an explicit enable / disable', () => {
    expect(
      toggleInstagramChatbotRequestSchema.safeParse({ enabled: true }).success
    ).toBe(true);
    expect(
      toggleInstagramChatbotRequestSchema.safeParse({ enabled: false }).success
    ).toBe(true);
  });

  it('rejects an omitted `enabled` — never an implicit "invert whatever is stored"', () => {
    expect(toggleInstagramChatbotRequestSchema.safeParse({}).success).toBe(
      false
    );
  });

  it('REJECTS an unknown / extra field (proves .strict())', () => {
    expect(
      toggleInstagramChatbotRequestSchema.safeParse({
        enabled: true,
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

describe('updateUserRequestSchema', () => {
  it('accepts a name-only edit — the only field either surface renders', () => {
    expect(
      updateUserRequestSchema.safeParse({ name: 'Dana Scully' }).success
    ).toBe(true);
  });

  it('accepts an empty body (a PATCH that changes nothing)', () => {
    expect(updateUserRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts `image: null` — remove the avatar', () => {
    expect(updateUserRequestSchema.safeParse({ image: null }).success).toBe(
      true
    );
  });

  it('rejects a 1-character name (the form enforces the same min)', () => {
    expect(updateUserRequestSchema.safeParse({ name: 'D' }).success).toBe(
      false
    );
  });

  it("rejects `email: ''` and `image: ''` — normalise blanks first", () => {
    expect(updateUserRequestSchema.safeParse({ email: '' }).success).toBe(
      false
    );
    expect(updateUserRequestSchema.safeParse({ image: '' }).success).toBe(
      false
    );
  });

  it('REJECTS `organizationId` — switching org is a different endpoint', () => {
    expect(
      updateUserRequestSchema.safeParse({ organizationId: 'org_1' }).success
    ).toBe(false);
  });

  it('REJECTS the route param `id` in the body', () => {
    expect(updateUserRequestSchema.safeParse({ id: 'user_1' }).success).toBe(
      false
    );
  });
});

describe('createAccountLinkRequestSchema', () => {
  it('accepts the two absolute redirect URLs', () => {
    expect(
      createAccountLinkRequestSchema.safeParse({
        returnUrl: 'https://app.example.com/settings/payments?stripe=return',
        refreshUrl: 'https://app.example.com/settings/payments?stripe=refresh',
      }).success
    ).toBe(true);
  });

  it('rejects a RELATIVE path — Stripe would redirect nowhere', () => {
    expect(
      createAccountLinkRequestSchema.safeParse({
        returnUrl: '/settings/payments?stripe=return',
        refreshUrl: '/settings/payments?stripe=refresh',
      }).success
    ).toBe(false);
  });

  it('requires BOTH urls — an expired link needs somewhere to land', () => {
    expect(
      createAccountLinkRequestSchema.safeParse({
        returnUrl: 'https://app.example.com/x',
      }).success
    ).toBe(false);
  });

  it('REJECTS the session context fields', () => {
    expect(
      createAccountLinkRequestSchema.safeParse({
        returnUrl: 'https://app.example.com/x',
        refreshUrl: 'https://app.example.com/y',
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

describe('linkStripeAccountRequestSchema', () => {
  it('accepts a Stripe account id', () => {
    expect(
      linkStripeAccountRequestSchema.safeParse({
        stripeAccountId: 'acct_1A2b3C4d5E6f7G8h',
      }).success
    ).toBe(true);
  });

  it('trims a pasted id', () => {
    const parsed = linkStripeAccountRequestSchema.safeParse({
      stripeAccountId: '  acct_1A2b3C4d5E6f7G8h ',
    });
    expect(parsed.success && parsed.data.stripeAccountId).toBe(
      'acct_1A2b3C4d5E6f7G8h'
    );
  });

  it.each([
    ['a secret key pasted by mistake', 'sk_live_51ABCdef'],
    ['a customer id', 'cus_1A2b3C4d'],
    ['the prefix alone', 'acct_'],
    ['an empty string', ''],
  ])('rejects %s', (_label, stripeAccountId) => {
    expect(
      linkStripeAccountRequestSchema.safeParse({ stripeAccountId }).success
    ).toBe(false);
  });

  it('REJECTS the session context fields', () => {
    expect(
      linkStripeAccountRequestSchema.safeParse({
        stripeAccountId: 'acct_1A2b3C4d',
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});
