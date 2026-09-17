import { describe, expect, it } from 'vitest';

import {
  buildCreateOfferPayload,
  buildUpdateOfferPayload,
} from './offer-payload';
import type { OfferFormIntent } from './offer-payload';

/**
 * `state` on the update path.
 *
 * The editor renders no state control, so whatever the form holds is simply
 * what was loaded. Sending it back is a read-modify-write of a field nobody
 * edited, and it loses in two ways that are invisible from the UI — both are
 * pinned here.
 */
const intent = (state: OfferFormIntent['state']): OfferFormIntent => ({
  name: 'Summer Special',
  description: null,
  code: null,
  state,
  discountType: 'percentage',
  discountPercent: 20,
  discountAmountEuros: null,
  originalPriceEuros: null,
  offerPriceEuros: null,
  buyQuantity: null,
  getQuantity: null,
  redemptionLimit: null,
  validFrom: null,
  validUntil: null,
  serviceIds: ['svc-1'],
  locationIds: [],
  limitPerClient: false,
});

describe('buildUpdateOfferPayload — state', () => {
  it('never sends state, so a save cannot change it', () => {
    const body = buildUpdateOfferPayload({
      source: 'form',
      values: intent('active'),
    });

    expect(body).not.toHaveProperty('state');
  });

  it('cannot reactivate a promotion paused since the form loaded', () => {
    // The form still holds the 'active' it loaded with. If that went to the
    // server, a promotion an owner paused in another tab would come back on
    // because someone corrected a typo in its name.
    const body = buildUpdateOfferPayload({
      source: 'form',
      values: intent('active'),
    });

    expect(body).not.toHaveProperty('state');
  });

  it('cannot launder an EXPIRED promotion into a paused one', () => {
    // `offerToForm` maps 'expired' onto 'paused' because the form has no
    // 'expired' option. Sending that back turned "this promotion has ended"
    // into "this promotion is paused" — a different, resumable state — just by
    // opening the editor and pressing Save.
    const body = buildUpdateOfferPayload({
      source: 'form',
      values: intent('paused'),
    });

    expect(body).not.toHaveProperty('state');
  });

  it('still sends state on CREATE, where it is the caller’s choice', () => {
    // Claire creates drafts; the dashboard creates active promotions. Create is
    // the one place the value is genuinely being decided.
    expect(buildCreateOfferPayload(intent('draft'))).toMatchObject({
      state: 'draft',
    });
    expect(buildCreateOfferPayload(intent('active'))).toMatchObject({
      state: 'active',
    });
  });
});
