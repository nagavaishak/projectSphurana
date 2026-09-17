import {
  adAccountCurrency,
  adAccountCurrencyForPages,
  resolveAdAccountCurrency,
} from './ad-currency.js';

/**
 * ENG-626. The connected Meta ad account's currency is the ONLY source of
 * truth for ad budgets/prices — every budget/price surface derives its symbol
 * from this one resolver, so a mismatch is impossible by construction. These
 * tests pin the two properties that guarantee makes:
 *
 *  1. an unusable code NEVER silently becomes a wrong symbol — it degrades to
 *     the EUR fallback with the "not resolved" flag the caller must surface;
 *  2. the page selection (active-only, defaultPageId preferred) matches what
 *     `plan-chat-turn` puts in Claire's prompt, so the prose and the tool
 *     cards cannot disagree.
 */
describe('adAccountCurrency', () => {
  it('resolves a 2-decimal ISO code', () => {
    expect(adAccountCurrency('GBP')).toEqual({
      currency: { code: 'GBP', symbol: '£' },
      supported: true,
    });
  });

  it('normalises case and surrounding whitespace', () => {
    expect(adAccountCurrency('  usd  ')).toEqual({
      currency: { code: 'USD', symbol: '$' },
      supported: true,
    });
  });

  it.each([null, undefined, '', '   '])(
    'falls back to EUR (unsupported) for %p',
    (code) => {
      expect(adAccountCurrency(code)).toEqual({
        currency: { code: 'EUR', symbol: '€' },
        supported: false,
      });
    }
  );

  it.each(['JPY', 'KRW', 'BHD'])(
    'falls back to EUR for the non-2-decimal currency %s',
    (code) => {
      // Every budget/price tool multiplies whole units by 100. Sending Meta a
      // 100×-wrong JPY budget is far worse than declaring EUR and saying so.
      const { currency, supported } = adAccountCurrency(code);
      expect(supported).toBe(false);
      expect(currency.code).toBe('EUR');
    }
  );

  it.each(['EU', 'EUROS', 'E1R', 'EUR; DROP', '€'])(
    'falls back to EUR for the non-ISO value %p',
    (code) => {
      // This value is interpolated into Claire's system prompt, so the
      // `^[A-Z]{3}$` gate is a prompt-injection boundary, not just tidiness.
      expect(adAccountCurrency(code).supported).toBe(false);
    }
  );
});

describe('adAccountCurrencyForPages', () => {
  // This is the single copy of the page-selection rule. `resolveAdAccountCurrency`
  // (the tools) and `plan-chat-turn` (Claire's system prompt) both call it, so
  // the prose and the tool cards cannot pick different pages.
  const page = (
    id: string,
    isActive: boolean,
    defaultAdAccountCurrency: string | null
  ) => ({ id, isActive, defaultAdAccountCurrency });

  it('prefers the defaultPageId among the ACTIVE pages', () => {
    expect(
      adAccountCurrencyForPages(
        [page('p1', true, 'USD'), page('p2', true, 'GBP')],
        'p2'
      )
    ).toEqual({ currency: { code: 'GBP', symbol: '£' }, supported: true });
  });

  it('skips a deactivated page even when it IS the defaultPageId', () => {
    expect(
      adAccountCurrencyForPages(
        [page('p1', false, 'USD'), page('p2', true, 'GBP')],
        'p1'
      )
    ).toEqual({ currency: { code: 'GBP', symbol: '£' }, supported: true });
  });

  it('takes the first active page when defaultPageId is null', () => {
    expect(
      adAccountCurrencyForPages(
        [page('p1', false, 'USD'), page('p2', true, 'GBP')],
        null
      )
    ).toEqual({ currency: { code: 'GBP', symbol: '£' }, supported: true });
  });

  it.each([[[]], [null], [undefined]])(
    'falls back to unsupported EUR for %p pages',
    (pages) => {
      expect(adAccountCurrencyForPages(pages, 'p1')).toEqual({
        currency: { code: 'EUR', symbol: '€' },
        supported: false,
      });
    }
  );
});

describe('resolveAdAccountCurrency', () => {
  const integration = (
    pages: Array<{
      id: string;
      isActive: boolean;
      defaultAdAccountCurrency?: string | null;
    }>,
    defaultPageId: string | null = null
  ) => ({ integration: { defaultPageId, pages } });

  const ctxWith = (value: unknown) => ({
    apiFetch: jest.fn().mockResolvedValue(value),
  });

  const EUR_FALLBACK = {
    currency: { code: 'EUR', symbol: '€' },
    resolved: false,
  };

  it('reads the currency of the default active page', async () => {
    const ctx = ctxWith(
      integration(
        [
          { id: 'p1', isActive: true, defaultAdAccountCurrency: 'USD' },
          { id: 'p2', isActive: true, defaultAdAccountCurrency: 'GBP' },
        ],
        'p2'
      )
    );

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual({
      currency: { code: 'GBP', symbol: '£' },
      resolved: true,
    });
  });

  it('falls back to the first ACTIVE page when defaultPageId is unset', async () => {
    const ctx = ctxWith(
      integration([
        { id: 'p1', isActive: false, defaultAdAccountCurrency: 'JPY' },
        { id: 'p2', isActive: true, defaultAdAccountCurrency: 'USD' },
      ])
    );

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual({
      currency: { code: 'USD', symbol: '$' },
      resolved: true,
    });
  });

  it('ignores a defaultPageId that points at a DEACTIVATED page', async () => {
    // A stale defaultPageId must not resolve a currency the operator no longer
    // bills in — and must not diverge from the prompt, which filters the same way.
    const ctx = ctxWith(
      integration(
        [
          { id: 'p1', isActive: false, defaultAdAccountCurrency: 'USD' },
          { id: 'p2', isActive: true, defaultAdAccountCurrency: 'GBP' },
        ],
        'p1'
      )
    );

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual({
      currency: { code: 'GBP', symbol: '£' },
      resolved: true,
    });
  });

  it('falls back to EUR (unresolved) when no page is active', async () => {
    const ctx = ctxWith(
      integration([
        { id: 'p1', isActive: false, defaultAdAccountCurrency: 'USD' },
      ])
    );

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual(
      EUR_FALLBACK
    );
  });

  it('falls back to EUR (unresolved) when no integration is connected', async () => {
    const ctx = ctxWith({ integration: null });

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual(
      EUR_FALLBACK
    );
  });

  it('falls back to EUR (unresolved) when the page reports no currency', async () => {
    const ctx = ctxWith(
      integration([
        { id: 'p1', isActive: true, defaultAdAccountCurrency: null },
      ])
    );

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual(
      EUR_FALLBACK
    );
  });

  it('falls back to EUR (unresolved) when the fetch throws', async () => {
    // Resolving currency must never break a budget/price tool call.
    const ctx = { apiFetch: jest.fn().mockRejectedValue(new Error('502')) };

    await expect(resolveAdAccountCurrency(ctx as never)).resolves.toEqual(
      EUR_FALLBACK
    );
  });

  it('validates the response against the declared contract schema', async () => {
    const ctx = ctxWith(integration([]));

    await resolveAdAccountCurrency(ctx as never);

    expect(ctx.apiFetch).toHaveBeenCalledWith(
      'integrations/meta-ads/integration',
      expect.objectContaining({ schema: expect.anything() })
    );
  });
});
