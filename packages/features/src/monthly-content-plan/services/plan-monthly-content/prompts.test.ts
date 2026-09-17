import { describe, expect, it } from 'vitest';
import type { OrgContext } from '../../../shared/org-context.js';
import { buildMonthlyPlanPrompt } from './prompts.js';

const orgContext: OrgContext = {
  businessType: 'aesthetics clinic',
  brandVoice: ['warm', 'expert'],
  targetAudienceDescription: 'women 30-55',
  tagline: 'Look your best',
  credibilityLine: '10 years experience',
} as OrgContext;

const videoAllowList = (userMessage: string) =>
  userMessage.split('VIDEO-ELIGIBLE SERVICES')[1].split('GRAPHIC-ELIGIBLE')[0];

const graphicAllowList = (userMessage: string) =>
  userMessage.split('GRAPHIC-ELIGIBLE SERVICES')[1].split('RECENT TOPICS')[0];

describe('buildMonthlyPlanPrompt — media gating', () => {
  it('tags each service with its media + video-footage state and gates each modality on the right one', () => {
    const { systemMessage, userMessage } = buildMonthlyPlanPrompt({
      orgContext,
      serviceCandidates: [
        {
          id: 'svc_with',
          name: 'Facial',
          painPoints: null,
          expectedResults: null,
          processDescription: null,
          targetArea: null,
          hasMedia: true,
          hasVideoFootage: true,
        },
        {
          id: 'svc_without',
          name: 'Massage',
          painPoints: null,
          expectedResults: null,
          processDescription: null,
          targetArea: null,
          hasMedia: false,
          hasVideoFootage: false,
        },
      ],
      recentTopics: [],
      periodMonth: '2026-01',
      videoCount: 2,
      carouselCount: 1,
      singleCount: 1,
      allowStockFootage: false,
    });

    // Each service line carries its media + video-footage state.
    expect(userMessage).toContain('hasMedia=true');
    expect(userMessage).toContain('hasMedia=false');
    expect(userMessage).toContain('hasVideoFootage=true');
    expect(userMessage).toContain('hasVideoFootage=false');

    // Both modalities gate on their own explicit allow-list — neither may
    // target a service that can't back it with the right media.
    expect(systemMessage).toMatch(/Graphic items.*GRAPHIC-ELIGIBLE/s);
    expect(systemMessage).toMatch(/Video items.*VIDEO-ELIGIBLE/s);

    // The user message includes a dedicated video allow-list containing only
    // the footage-backed service, not the footage-less one.
    const allowList = videoAllowList(userMessage);
    expect(allowList).toContain('id="svc_with"');
    expect(allowList).not.toContain('id="svc_without"');

    // With stock declined, the graphic allow-list holds only the media-backed
    // service.
    const graphicList = graphicAllowList(userMessage);
    expect(graphicList).toContain('id="svc_with"');
    expect(graphicList).not.toContain('id="svc_without"');
  });

  it('renders "(none)" in the video allow-list when no service has footage', () => {
    const { userMessage } = buildMonthlyPlanPrompt({
      orgContext,
      serviceCandidates: [
        {
          id: 'svc_graphic_only',
          name: 'Facial',
          painPoints: null,
          expectedResults: null,
          processDescription: null,
          targetArea: null,
          hasMedia: true,
          hasVideoFootage: false,
        },
      ],
      recentTopics: [],
      periodMonth: '2026-01',
      videoCount: 2,
      carouselCount: 1,
      singleCount: 1,
      allowStockFootage: false,
    });

    const allowList = videoAllowList(userMessage);
    expect(allowList).toContain('(none');
    expect(allowList).not.toContain('id="svc_graphic_only"');
  });

  it('includes footage-less services in the video allow-list when stock is allowed', () => {
    const { userMessage } = buildMonthlyPlanPrompt({
      orgContext,
      serviceCandidates: [
        {
          id: 'svc_stock_ok',
          name: 'Massage',
          painPoints: null,
          expectedResults: null,
          processDescription: null,
          targetArea: null,
          hasMedia: false,
          hasVideoFootage: false,
        },
      ],
      recentTopics: [],
      periodMonth: '2026-01',
      videoCount: 1,
      carouselCount: 0,
      singleCount: 0,
      allowStockFootage: true,
    });

    const allowList = videoAllowList(userMessage);
    expect(allowList).toContain('id="svc_stock_ok"');
  });

  it('includes media-less services in the GRAPHIC allow-list when stock is allowed', () => {
    // The prod bug: an org with zero media-backed services was asked for six
    // graphics while the prompt simultaneously forbade placing any, so the
    // model returned three and the batch shipped 9 of 12. Graphics fall back
    // through stock stills -> generated imagery exactly like video does.
    const { systemMessage, userMessage } = buildMonthlyPlanPrompt({
      orgContext,
      serviceCandidates: [
        {
          id: 'svc_stock_ok',
          name: 'Massage',
          painPoints: null,
          expectedResults: null,
          processDescription: null,
          targetArea: null,
          hasMedia: false,
          hasVideoFootage: false,
        },
      ],
      recentTopics: [],
      periodMonth: '2026-01',
      videoCount: 0,
      carouselCount: 1,
      singleCount: 1,
      allowStockFootage: true,
    });

    expect(graphicAllowList(userMessage)).toContain('id="svc_stock_ok"');
    // ...and the service line must not read as a prohibition either.
    expect(userMessage).toContain('hasMedia=false (graphics OK');
    expect(systemMessage).not.toMatch(/cannot have a graphic/);
  });
});
