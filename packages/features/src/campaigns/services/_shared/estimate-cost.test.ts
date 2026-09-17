import { describe, expect, it } from '@borradh-workspace/testing';
import { estimateCampaignCost } from './estimate-cost.js';

describe('estimateCampaignCost', () => {
  it('meters SMS only; email + WhatsApp are free for campaigns', () => {
    const est = estimateCampaignCost({ email: 100, sms: 50, whatsapp: 30 });

    // SMS rate is 100 raw units (1 credit) each → 50 credits.
    expect(est.perChannel.sms.credits).toBe(50);
    expect(est.perChannel.sms.metered).toBe(true);

    expect(est.perChannel.email.credits).toBe(0);
    expect(est.perChannel.email.metered).toBe(false);
    expect(est.perChannel.whatsapp.credits).toBe(0);

    expect(est.totalCredits).toBe(50);
  });

  it('is zero when there are no SMS recipients', () => {
    const est = estimateCampaignCost({ email: 1000, sms: 0, whatsapp: 500 });
    expect(est.totalCredits).toBe(0);
  });

  it('respects an override of which channels are paid', () => {
    const est = estimateCampaignCost({ email: 10, sms: 0, whatsapp: 0 }, [
      'email',
      'sms',
      'whatsapp',
    ]);
    // email rate is 10 raw units (0.1 credit) each → 1 credit for 10.
    expect(est.perChannel.email.credits).toBeCloseTo(1);
    expect(est.totalCredits).toBeCloseTo(1);
  });
});
