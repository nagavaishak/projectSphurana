import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type ClaudeMonthlyPlan,
  claudeMonthlyPlanSchema,
  planMonthlyContentSchema,
} from './plan-monthly-content.schema.js';
import {
  planMonthlyContent,
  validatePlan,
} from './plan-monthly-content.service.js';

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

const item = (
  kind: 'video' | 'carousel' | 'single',
  targetServiceId: string,
  topicSummary = `${kind} ${targetServiceId}`
): ClaudeMonthlyPlan['items'][number] => ({
  kind,
  targetServiceId,
  topicSummary,
  rationale: 'because',
});

describe('planMonthlyContent input schema', () => {
  it('accepts valid input with defaults', () => {
    const parsed = planMonthlyContentSchema.safeParse({
      organizationId: VALID_ID,
      periodMonth: '2026-01',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.videoCount).toBe(4);
      expect(parsed.data.carouselCount).toBe(4);
      expect(parsed.data.singleCount).toBe(4);
      expect(parsed.data.recentTopicsLookbackDays).toBe(60);
    }
  });

  it('rejects bad periodMonth', () => {
    const parsed = planMonthlyContentSchema.safeParse({
      organizationId: VALID_ID,
      periodMonth: '2026/01',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts an optional serviceIds hard-filter', () => {
    const parsed = planMonthlyContentSchema.safeParse({
      organizationId: VALID_ID,
      periodMonth: '2026-01',
      serviceIds: ['svc_1', 'svc_2'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.serviceIds).toEqual(['svc_1', 'svc_2']);
    }
  });

  it('rejects empty organizationId', () => {
    const parsed = planMonthlyContentSchema.safeParse({
      organizationId: '',
      periodMonth: '2026-01',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('claudeMonthlyPlanSchema', () => {
  it('accepts a well-formed plan', () => {
    const parsed = claudeMonthlyPlanSchema.safeParse({
      items: [
        {
          kind: 'video',
          targetServiceId: 'svc-1',
          topicSummary: 'Topic',
          rationale: 'Reason',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid kind', () => {
    const parsed = claudeMonthlyPlanSchema.safeParse({
      items: [
        {
          kind: 'reel',
          targetServiceId: 'svc-1',
          topicSummary: 'Topic',
          rationale: 'Reason',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty topicSummary', () => {
    const parsed = claudeMonthlyPlanSchema.safeParse({
      items: [
        {
          kind: 'video',
          targetServiceId: 'svc-1',
          topicSummary: '',
          rationale: 'Reason',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('validatePlan — graceful degradation', () => {
  // svc_v: has video footage + media. svc_g: media only. svc_none: neither
  // (video still eligible via the stock-footage fallback in planVideoDetail).
  const candidates = new Set(['svc_v', 'svc_g', 'svc_none']);
  const media = new Set(['svc_v', 'svc_g']);
  const videoFootage = new Set(['svc_v']);

  it('keeps a fully eligible plan unchanged', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [
        item('video', 'svc_v'),
        item('carousel', 'svc_g'),
        item('single', 'svc_g'),
      ],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      1,
      1,
      1
    );
    expect(res.items).toHaveLength(3);
    expect(res.dropped).toHaveLength(0);
  });

  it('keeps multiple videos on the same footage-backed service when topics are distinct', () => {
    // The requested video count is NOT clamped to the number of
    // footage-backed services — one service with footage can back the whole
    // video allocation as long as each item has a fresh topic.
    const plan: ClaudeMonthlyPlan = {
      items: [
        item('video', 'svc_v', 'behind the scenes of a session'),
        item('video', 'svc_v', 'client transformation reveal'),
        item('video', 'svc_v', 'what to expect on your first visit'),
      ],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      3,
      0,
      0
    );
    expect(res.items).toHaveLength(3);
    expect(res.dropped).toHaveLength(0);
  });

  it('keeps a video targeting a footage-less service (stock-footage fallback)', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [item('video', 'svc_none'), item('carousel', 'svc_g')],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      1,
      1,
      0,
      true
    );
    expect(res.items).toHaveLength(2);
    expect(res.dropped).toHaveLength(0);
  });

  it('drops a video targeting a footage-less service when stock footage is off', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [item('video', 'svc_none'), item('single', 'svc_g')],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      1,
      0,
      1,
      false
    );
    expect(res.items).toHaveLength(1);
    expect(res.dropped[0]?.reason).toBe(
      'video targets service with no uploaded footage'
    );
  });

  it('KEEPS a graphic on a media-less service when stock is allowed', () => {
    // SHIPPED DEFECT — the reason a batch came back 6 videos and 0 graphics.
    //
    // This gate is the THIRD copy of the graphics-eligibility rule and the last
    // one in the pipeline, so it overruled the two count gates that had already
    // been fixed: the counts said "plan 6 graphics", the model produced them,
    // and every one was dropped here. `resolve-slot-image` falls back
    // stock-image -> ai-generated, so a graphic does not need an upload —
    // `allowStockFootage` is the owner's consent to exactly that, and it
    // defaults to true, which is why this fired for ordinary orgs.
    const plan: ClaudeMonthlyPlan = { items: [item('single', 'svc_none')] };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      0,
      0,
      1,
      true
    );
    expect(res.items).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('drops a graphic on a media-less service when stock is OFF', () => {
    // The rule still exists — it is consent-gated, not deleted. An owner who
    // declined stock gets neither stock stills nor generated imagery.
    const plan: ClaudeMonthlyPlan = { items: [item('single', 'svc_none')] };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      0,
      0,
      1,
      false
    );
    expect(res.items).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe(
      'graphic targets service with no uploaded media'
    );
  });

  it('drops items that exceed the requested per-kind count', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [
        item('single', 'svc_g', 'a'),
        item('single', 'svc_g', 'b'),
        item('single', 'svc_g', 'c'),
      ],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      0,
      0,
      2
    );
    expect(res.items).toHaveLength(2);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0]?.reason).toBe('exceeds requested single count');
  });

  it('drops duplicate topics (recent and within-plan)', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [
        item('single', 'svc_g', 'Hydration tips'),
        item('single', 'svc_g', 'hydration tips'), // dup within plan
        item('carousel', 'svc_g', 'Recent angle'), // dup of recent topic
      ],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      ['recent angle'],
      0,
      1,
      2
    );
    expect(res.items).toHaveLength(1);
    expect(res.dropped.map((d) => d.reason)).toEqual([
      'duplicate topic',
      'duplicate topic',
    ]);
  });

  it('returns an empty plan (caller fails) when nothing is eligible', () => {
    const plan: ClaudeMonthlyPlan = {
      items: [item('video', 'svc_unknown'), item('single', 'svc_unknown2')],
    };
    const res = validatePlan(
      plan,
      candidates,
      media,
      videoFootage,
      [],
      1,
      0,
      1
    );
    expect(res.items).toHaveLength(0);
    expect(res.dropped).toHaveLength(2);
  });
});

describe('planMonthlyContent service-level validation', () => {
  it('rejects missing organizationId', async () => {
    const result = await planMonthlyContent(
      undefined as never,
      {
        organizationId: '',
        periodMonth: '2026-01',
        videoCount: 4,
        carouselCount: 4,
        singleCount: 4,
        recentTopicsLookbackDays: 60,
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects bad periodMonth', async () => {
    const result = await planMonthlyContent(
      undefined as never,
      {
        organizationId: VALID_ID,
        periodMonth: '2026-13',
        videoCount: 4,
        carouselCount: 4,
        singleCount: 4,
        recentTopicsLookbackDays: 60,
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
