import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAdsService, isMessengerEligible } from './meta-ads.service.js';
import type { MetaLeadFormConfig } from './meta-ads.types.js';

const PAGE_ID = 'page-123';

function okResponse(id = 'form-abc'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id }),
    text: async () => JSON.stringify({ id }),
  } as unknown as Response;
}

/** A Meta error response with an arbitrary code (default #3 = capability). */
function errorResponse(code = 3, message = '(#3) capability'): Response {
  const body = { error: { message, type: 'OAuthException', code } };
  return {
    ok: false,
    status: 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The questions we ship by default — all Messenger-eligible. */
const eligibleQuestions: MetaLeadFormConfig['questions'] = [
  { type: 'FULL_NAME' },
  { type: 'EMAIL' },
  { type: 'PHONE' },
];

const baseConfig: MetaLeadFormConfig = {
  name: 'Test Form',
  questions: eligibleQuestions,
  privacyPolicy: { url: 'https://example.com/privacy' },
};

describe('MetaAdsService.createLeadGenForm — Messenger auto-start', () => {
  let service: MetaAdsService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new MetaAdsService({
      accessToken: 'token',
      adAccountId: 'act_1',
      pageId: PAGE_ID,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Parse the JSON body the service POSTed to Meta. */
  function sentPayload(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  function sentThankYouPage(): Record<string, unknown> {
    return JSON.parse(sentPayload().thank_you_page as string);
  }

  it('enables Messenger by default even with no thank-you page configured', async () => {
    await service.createLeadGenForm(baseConfig);

    // Messenger auto-start = a P2B_MESSENGER thank-you-page button. That button
    // IS what the "Start conversations on Messenger" checkbox produces (verified
    // against a hand-built form). A form with zero thank-you config must still
    // get one so the button is present.
    expect(sentThankYouPage().button_type).toBe('P2B_MESSENGER');
    expect(sentPayload().block_display_for_non_targeted_viewer).toBe(false);
    // THE trigger: Meta's own UI sends this flag to tick "Start conversations
    // on Messenger". Verified by capturing the Business Suite POST.
    expect(sentPayload().is_auto_thread_creation_enabled).toBe(true);
  });

  it('forces a Messenger button even when a WhatsApp CTA is requested', async () => {
    await service.createLeadGenForm({
      ...baseConfig,
      thankYouPage: {
        buttonType: 'WHATSAPP',
        businessPhoneNumber: '+353871234567',
      },
    });

    // Auto-start wins: the button becomes P2B_MESSENGER, not WhatsApp.
    expect(sentThankYouPage().button_type).toBe('P2B_MESSENGER');
  });

  it('preserves custom thank-you copy while enabling Messenger', async () => {
    await service.createLeadGenForm({
      ...baseConfig,
      thankYouPage: { title: 'Nice one', body: 'We will call you' },
    });

    const tp = sentThankYouPage();
    expect(tp.title).toBe('Nice one');
    expect(tp.body).toBe('We will call you');
    expect(tp.button_type).toBe('P2B_MESSENGER');
  });

  it('can be explicitly opted out', async () => {
    await service.createLeadGenForm({
      ...baseConfig,
      thankYouPage: { enableMessenger: false, buttonUrl: 'https://x.com' },
    });

    // Opted out → no forced Messenger button; the website CTA stands.
    expect(sentThankYouPage().button_type).toBe('VIEW_WEBSITE');
    expect(sentPayload().block_display_for_non_targeted_viewer).toBeUndefined();
    expect(sentPayload().is_auto_thread_creation_enabled).toBeUndefined();
  });

  it('drops the auto-start flag and retries when Meta returns #3 (no capability)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // First attempt (with the flag) hits the capability wall; retry succeeds.
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(3, '(#3) Application does not have the capability')
      )
      .mockResolvedValueOnce(okResponse('form-retry'));

    const id = await service.createLeadGenForm(baseConfig);

    expect(id).toBe('form-retry');
    const bodyOf = (i: number) =>
      JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string);
    // First attempt carried the flag…
    expect(bodyOf(0).is_auto_thread_creation_enabled).toBe(true);
    // …the retry dropped ONLY the flag but kept the Messenger button.
    expect(bodyOf(1).is_auto_thread_creation_enabled).toBeUndefined();
    expect(JSON.parse(bodyOf(1).thank_you_page).button_type).toBe(
      'P2B_MESSENGER'
    );
  });

  it('does NOT swallow non-capability errors (e.g. #100)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(errorResponse(100, 'Invalid parameter'));
    await expect(service.createLeadGenForm(baseConfig)).rejects.toThrow();
  });

  it('falls back to off (and warns) when a question type is ineligible', async () => {
    const warn = vi.spyOn(console, 'warn');

    await service.createLeadGenForm({
      ...baseConfig,
      questions: [...eligibleQuestions, { type: 'CITY' }],
      thankYouPage: { title: 'Thanks' },
    });

    // Must not force the Messenger button — an ineligible form can't auto-start.
    expect(sentThankYouPage().button_type).not.toBe('P2B_MESSENGER');
    expect(sentPayload().block_display_for_non_targeted_viewer).toBeUndefined();
    expect(sentPayload().is_auto_thread_creation_enabled).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CITY'));
  });

  it('sends date of birth using Meta\u2019s DOB code', async () => {
    // Meta rejects the ENTIRE form on an unknown question type, so a wrong
    // code here makes the form permanently unsyncable — not a degraded field.
    await service.createLeadGenForm({
      ...baseConfig,
      questions: [{ type: 'FULL_NAME' }, { type: 'DATE_OF_BIRTH' }],
    });

    const sent = JSON.parse(sentPayload().questions as string) as Array<{
      type: string;
    }>;
    expect(sent.map((q) => q.type)).toEqual(['FULL_NAME', 'DOB']);
  });

  it('still creates the form when Messenger is unavailable', async () => {
    const id = await service.createLeadGenForm({
      ...baseConfig,
      questions: [{ type: 'GENDER' }],
    });

    expect(id).toBe('form-abc');
  });
});

describe('isMessengerEligible', () => {
  it('accepts the Meta-eligible question types', () => {
    expect(
      isMessengerEligible([
        { type: 'FULL_NAME' },
        { type: 'FIRST_NAME' },
        { type: 'LAST_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
        { type: 'CUSTOM' },
      ])
    ).toBe(true);
  });

  it('rejects any other type', () => {
    expect(isMessengerEligible([{ type: 'FULL_NAME' }, { type: 'ZIP' }])).toBe(
      false
    );
  });

  it('treats an empty question set as eligible', () => {
    expect(isMessengerEligible([])).toBe(true);
  });
});
