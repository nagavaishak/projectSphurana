import { chatCompletion } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeService } from './__fixtures__/index.js';
import { selectServices } from './select-services.js';

// `@borradh-workspace/ai` is canonically mocked via the vite.config.ts alias, so
// the real OpenAI/Anthropic clients never load and every test file shares the
// same mock object. Drive `chatCompletion` with `vi.mocked()`. A file-local
// `vi.mock` of this boundary would leak across the shared worker graph under
// `isolate: false`. The canonical mock already returns `isAIClientInitialized()
// => true`, so no client-init stubbing is needed. Every queued return uses
// `…Once` so this file leaves no persistent state on the shared mock.
// See docs/plans/features-test-suite-speedup.md.
const mockChatCompletion = vi.mocked(chatCompletion);

const AXES = {
  retentionModel: 'rebooking',
  commitmentLevel: 'planned',
  marketPosition: 'at',
} as const;

const menu = () => [
  makeService({ name: 'Non-Surgical Facelift', priceText: 'From £450' }),
  makeService({ name: 'Chemical Peels', priceText: '£100' }),
  makeService({ name: 'Lip Filler Treatment', priceText: '£135' }),
];

const input = (services = menu()) => ({
  organizationName: 'Test Clinic',
  services,
  axes: AXES,
  chatbotSettings: null,
  verticalMetadata: {},
});

describe('selectServices (LLM picker)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the picks in priority order with strategy + intro price', async () => {
    const services = menu();
    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        picks: [
          {
            serviceId: services[1].id, // Chemical Peels — the get-in-the-door pick
            offerStrategy: 'price_visible_intro',
            suggestedIntroPriceCents: 6500,
            reason: 'Course-based, low barrier, brings clients back.',
          },
          {
            serviceId: services[0].id, // Non-Surgical Facelift
            offerStrategy: 'price_hidden_conversation',
            suggestedIntroPriceCents: null,
            reason: 'Higher ticket — qualify in chat.',
          },
        ],
      }),
      finishReason: 'stop',
    });

    const result = await selectServices(input(services));
    expect(result).not.toBeNull();
    expect(result).toEqual([
      {
        serviceId: services[1].id,
        offerStrategy: 'price_visible_intro',
        suggestedIntroPrice: 6500,
        reason: 'Course-based, low barrier, brings clients back.',
      },
      {
        serviceId: services[0].id,
        offerStrategy: 'price_hidden_conversation',
        suggestedIntroPrice: undefined,
        reason: 'Higher ticket — qualify in chat.',
      },
    ]);
  });

  it('drops picks whose serviceId is not in the real menu (no hallucinated ids)', async () => {
    const services = menu();
    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        picks: [
          {
            serviceId: 'made-up-id',
            offerStrategy: 'price_visible_intro',
            reason: 'x',
          },
          {
            serviceId: services[1].id,
            offerStrategy: 'price_visible_intro',
            reason: 'real',
          },
        ],
      }),
      finishReason: 'stop',
    });

    const result = await selectServices(input(services));
    expect(result).toEqual([
      {
        serviceId: services[1].id,
        offerStrategy: 'price_visible_intro',
        suggestedIntroPrice: undefined,
        reason: 'real',
      },
    ]);
  });

  it('returns null on non-JSON so the caller falls back to the keyword ranker', async () => {
    mockChatCompletion.mockResolvedValueOnce({
      content: 'not json',
      finishReason: 'stop',
    });
    expect(await selectServices(input())).toBeNull();
  });

  it('returns null for an empty menu without calling the LLM', async () => {
    mockChatCompletion.mockClear();
    expect(await selectServices(input([]))).toBeNull();
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('bounds each provider attempt and owns retries at the selection layer', async () => {
    const services = menu();
    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        picks: [
          {
            serviceId: services[0].id,
            offerStrategy: 'price_hidden_conversation',
            reason: 'Suitable for consultation-led qualification.',
          },
        ],
      }),
      finishReason: 'stop',
    });

    await selectServices(input(services));

    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 20_000, maxRetries: 0 })
    );
  });
});
