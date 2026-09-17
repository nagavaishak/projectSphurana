import { describe, expect, it } from 'vitest';
import {
  acceptBatchItemRequestSchema,
  createAssetRequestSchema,
  createSocialPostRequestSchema,
  createVideoRequestSchema,
  createVoiceScriptRequestSchema,
  generateContentRequestSchema,
  generateGraphicFromServiceRequestSchema,
  generateOfferContentRequestSchema,
  generateOfferCopyRequestSchema,
  generateOrganicCopyRequestSchema,
  generateVideoScriptRequestSchema,
  partialDraftConfigSchema,
  patchVideoDraftConfigRequestSchema,
  updateFaceGroupRequestSchema,
  updateSocialPostRequestSchema,
  updateVideoRequestSchema,
  updateVoiceScriptRequestSchema,
} from './content.js';

describe('createSocialPostRequestSchema', () => {
  const validPost = {
    title: 'Launch Post',
    mediaType: 'image' as const,
    mediaUrl: 'https://cdn.example.com/a.jpg',
    pageIds: ['page_1'],
  };

  it('accepts a body targeted by pageIds', () => {
    expect(createSocialPostRequestSchema.safeParse(validPost).success).toBe(
      true
    );
  });

  it('accepts a body targeted by platforms instead', () => {
    const { pageIds: _omit, ...rest } = validPost;
    expect(
      createSocialPostRequestSchema.safeParse({
        ...rest,
        platforms: ['instagram'],
      }).success
    ).toBe(true);
  });

  it('rejects a body with NEITHER platforms nor pageIds (the .refine())', () => {
    const { pageIds: _omit, ...rest } = validPost;
    const result = createSocialPostRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/platforms or pageIds/);
    }
  });

  it('rejects empty arrays for BOTH targets (present but useless)', () => {
    expect(
      createSocialPostRequestSchema.safeParse({
        ...validPost,
        pageIds: [],
        platforms: [],
      }).success
    ).toBe(false);
  });

  it('carries `mediaUrls` — the carousel field the hand-copied DTO had lost', () => {
    const result = createSocialPostRequestSchema.safeParse({
      ...validPost,
      mediaUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
    });
    expect(result.success).toBe(true);
  });

  it('carries `status` — the other field the hand-copied DTO had lost', () => {
    expect(
      createSocialPostRequestSchema.safeParse({
        ...validPost,
        status: 'scheduled',
      }).success
    ).toBe(true);
  });

  it('COERCES an ISO `scheduledAt` string to a Date (server shape)', () => {
    const parsed = createSocialPostRequestSchema.parse({
      ...validPost,
      scheduledAt: '2026-02-03T10:00:00.000Z',
    });
    expect(parsed.scheduledAt).toBeInstanceOf(Date);
  });

  it('accepts `null` scheduledAt (a draft)', () => {
    expect(
      createSocialPostRequestSchema.safeParse({
        ...validPost,
        scheduledAt: null,
      }).success
    ).toBe(true);
  });

  it('REJECTS the server-injected `createdById` (proves .strict())', () => {
    const result = createSocialPostRequestSchema.safeParse({
      ...validPost,
      createdById: 'user_1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL mediaUrl', () => {
    expect(
      createSocialPostRequestSchema.safeParse({ ...validPost, mediaUrl: '' })
        .success
    ).toBe(false);
  });
});

describe('createAssetRequestSchema', () => {
  const validAsset = {
    name: 'clip-01',
    blobUrl: 'https://cdn.example.com/clip-01.mp4',
  };

  it('accepts a minimal asset body', () => {
    expect(createAssetRequestSchema.safeParse(validAsset).success).toBe(true);
  });

  it('MATERIALISES the defaults (type/source/tags/placeholderTypes)', () => {
    const parsed = createAssetRequestSchema.parse(validAsset);
    expect(parsed).toMatchObject({
      type: 'video',
      source: 'raw',
      tags: [],
      placeholderTypes: [],
    });
  });

  it('rejects a blank blobUrl (uploads must resolve a URL first)', () => {
    expect(
      createAssetRequestSchema.safeParse({ ...validAsset, blobUrl: '' }).success
    ).toBe(false);
  });

  it('rejects a non-ISO capturedAt', () => {
    expect(
      createAssetRequestSchema.safeParse({
        ...validAsset,
        capturedAt: '2026-02-03',
      }).success
    ).toBe(false);
  });

  it('REJECTS the server-injected `uploadedById`', () => {
    expect(
      createAssetRequestSchema.safeParse({
        ...validAsset,
        uploadedById: 'user_1',
      }).success
    ).toBe(false);
  });
});

describe('generateContentRequestSchema', () => {
  const valid = {
    mediaType: 'video' as const,
    mediaId: 'vid_1',
    contentType: 'social-post' as const,
  };

  it('accepts a valid generate body', () => {
    expect(generateContentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('carries the explicit `includeOffer` opt-in', () => {
    expect(
      generateContentRequestSchema.safeParse({ ...valid, includeOffer: true })
        .success
    ).toBe(true);
  });

  it('rejects a body missing `mediaId`', () => {
    const { mediaId: _omit, ...rest } = valid;
    expect(generateContentRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('REJECTS the server-injected `organizationId`', () => {
    expect(
      generateContentRequestSchema.safeParse({ ...valid, organizationId: 'o1' })
        .success
    ).toBe(false);
  });
});

describe('generateOfferContentRequestSchema', () => {
  it('accepts an empty body (the generator picks the headline offer)', () => {
    expect(generateOfferContentRequestSchema.safeParse({}).success).toBe(true);
  });

  it('REJECTS an unknown field', () => {
    expect(
      generateOfferContentRequestSchema.safeParse({ offerId: 'o1' }).success
    ).toBe(false);
  });
});

describe('generateOfferCopyRequestSchema', () => {
  it('accepts the re-roll protocol (instruction + priorCopy)', () => {
    expect(
      generateOfferCopyRequestSchema.safeParse({
        offerId: 'offer_1',
        refinementInstruction: 'lead with the price',
        priorCopy: { headline: 'old' },
      }).success
    ).toBe(true);
  });

  it('rejects a refinementInstruction over 500 chars', () => {
    expect(
      generateOfferCopyRequestSchema.safeParse({
        offerId: 'offer_1',
        refinementInstruction: 'a'.repeat(501),
      }).success
    ).toBe(false);
  });

  it('rejects a body missing `offerId`', () => {
    expect(generateOfferCopyRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('generateOrganicCopyRequestSchema', () => {
  it('accepts a known organic variation', () => {
    expect(
      generateOrganicCopyRequestSchema.safeParse({
        variationId: 'ins-outs-1',
      }).success
    ).toBe(true);
  });

  it('rejects a variation with no copywriter prompt behind it', () => {
    expect(
      generateOrganicCopyRequestSchema.safeParse({
        variationId: 'not-a-template-1',
      }).success
    ).toBe(false);
  });
});

describe('generateVideoScriptRequestSchema', () => {
  it('accepts a valid script request', () => {
    expect(
      generateVideoScriptRequestSchema.safeParse({
        templateId: 'before-after',
        variationId: 'before-after-1',
        narrationMode: 'ai_voiceover',
      }).success
    ).toBe(true);
  });

  it('rejects a request with no variation (a script needs a beat structure)', () => {
    expect(
      generateVideoScriptRequestSchema.safeParse({ templateId: 'before-after' })
        .success
    ).toBe(false);
  });
});

describe('generateGraphicFromServiceRequestSchema', () => {
  const valid = { serviceId: 'svc_1' };

  it('MATERIALISES the image-sourcing policy defaults', () => {
    const parsed = generateGraphicFromServiceRequestSchema.parse(valid);
    // AI imagery is OPT-IN; curated stock is OPT-OUT.
    expect(parsed).toMatchObject({
      category: 'tips',
      allowAiImages: false,
      allowStockImages: true,
      usageType: 'organic',
    });
  });

  it('accepts pinned source assets (1–10)', () => {
    expect(
      generateGraphicFromServiceRequestSchema.safeParse({
        ...valid,
        sourceAssetIds: ['a_1', 'a_2'],
      }).success
    ).toBe(true);
  });

  it('rejects an empty sourceAssetIds array (pin nothing = omit the key)', () => {
    expect(
      generateGraphicFromServiceRequestSchema.safeParse({
        ...valid,
        sourceAssetIds: [],
      }).success
    ).toBe(false);
  });

  it('rejects more than 10 pinned source assets', () => {
    expect(
      generateGraphicFromServiceRequestSchema.safeParse({
        ...valid,
        sourceAssetIds: Array.from({ length: 11 }, (_, i) => `a_${i}`),
      }).success
    ).toBe(false);
  });

  it('REJECTS the server-injected `organizationId`', () => {
    expect(
      generateGraphicFromServiceRequestSchema.safeParse({
        ...valid,
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

describe('createVoiceScriptRequestSchema', () => {
  const valid = { initialMessage: 'Hi there, is now a good time?' };

  it('MATERIALISES the defaults (name / isDefault / arrays)', () => {
    const parsed = createVoiceScriptRequestSchema.parse(valid);
    expect(parsed).toMatchObject({
      name: 'Default Script',
      isDefault: true,
      qualificationQuestions: [],
      followUps: [],
    });
  });

  it('rejects a body missing `initialMessage`', () => {
    expect(createVoiceScriptRequestSchema.safeParse({}).success).toBe(false);
  });

  it('PASSES THROUGH unknown `agentConfig` keys (provider options move independently)', () => {
    const parsed = createVoiceScriptRequestSchema.parse({
      ...valid,
      agentConfig: { voice: 'v1', someProviderOnlyKnob: 42 },
    });
    expect(parsed.agentConfig).toMatchObject({ someProviderOnlyKnob: 42 });
  });

  it('still REJECTS an unknown TOP-LEVEL key', () => {
    expect(
      createVoiceScriptRequestSchema.safeParse({
        ...valid,
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

describe('acceptBatchItemRequestSchema', () => {
  it('accepts an empty body (keep every planner-seeded value)', () => {
    expect(acceptBatchItemRequestSchema.safeParse({}).success).toBe(true);
  });

  it('distinguishes ABSENT from null `scheduledAt`', () => {
    // Absent → keep the planner's schedule. Null → draft it instead.
    expect(acceptBatchItemRequestSchema.parse({})).not.toHaveProperty(
      'scheduledAt'
    );
    expect(
      acceptBatchItemRequestSchema.parse({ scheduledAt: null }).scheduledAt
    ).toBeNull();
  });

  it('COERCES an ISO `scheduledAt` string to a Date', () => {
    const parsed = acceptBatchItemRequestSchema.parse({
      scheduledAt: '2026-02-03T10:00:00.000Z',
    });
    expect(parsed.scheduledAt).toBeInstanceOf(Date);
  });

  it('REJECTS the route param `itemId` in the body', () => {
    expect(
      acceptBatchItemRequestSchema.safeParse({ itemId: 'item_1' }).success
    ).toBe(false);
  });
});

describe('updateSocialPostRequestSchema', () => {
  it('accepts an empty body (a PATCH that changes nothing)', () => {
    expect(updateSocialPostRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a caption-only edit (the mobile detail surface)', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ caption: 'New copy' }).success
    ).toBe(true);
  });

  it('accepts `caption: null` — the documented CLEAR', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ caption: null }).success
    ).toBe(true);
  });

  it('accepts `scheduledAt: null` — unschedule back to draft', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ scheduledAt: null }).success
    ).toBe(true);
  });

  it('coerces an ISO `scheduledAt` string to a Date', () => {
    const result = updateSocialPostRequestSchema.safeParse({
      scheduledAt: '2026-03-01T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scheduledAt).toBeInstanceOf(Date);
  });

  it('rejects a BLANKED title — omit it, do not empty it', () => {
    expect(updateSocialPostRequestSchema.safeParse({ title: '' }).success).toBe(
      false
    );
  });

  it('rejects an empty `platforms` array', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ platforms: [] }).success
    ).toBe(false);
  });

  it('REJECTS `status: published` — publication is worker-owned', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ status: 'published' }).success
    ).toBe(false);
  });

  it('accepts the two client-settable statuses', () => {
    for (const status of ['draft', 'scheduled']) {
      expect(updateSocialPostRequestSchema.safeParse({ status }).success).toBe(
        true
      );
    }
  });

  it('REJECTS the route param `id` and the session `organizationId`', () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ id: 'sp_1' }).success
    ).toBe(false);
    expect(
      updateSocialPostRequestSchema.safeParse({ organizationId: 'org_1' })
        .success
    ).toBe(false);
  });
});

describe('updateVoiceScriptRequestSchema', () => {
  it('accepts an empty body (a PATCH that changes nothing)', () => {
    expect(updateVoiceScriptRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts `script: null` — the directive card CLEARING the prompt', () => {
    expect(
      updateVoiceScriptRequestSchema.safeParse({ script: null }).success
    ).toBe(true);
  });

  it('accepts `agentConfig: null`', () => {
    expect(
      updateVoiceScriptRequestSchema.safeParse({ agentConfig: null }).success
    ).toBe(true);
  });

  it('passes unknown `agentConfig` keys through to the provider', () => {
    const result = updateVoiceScriptRequestSchema.safeParse({
      agentConfig: { voice: 'alloy', providerOnlyKnob: 7 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig).toMatchObject({ providerOnlyKnob: 7 });
    }
  });

  it('does NOT apply the create-time defaults — a PATCH rewrites nothing', () => {
    const result = updateVoiceScriptRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('rejects a BLANKED name or initialMessage', () => {
    expect(updateVoiceScriptRequestSchema.safeParse({ name: '' }).success).toBe(
      false
    );
    expect(
      updateVoiceScriptRequestSchema.safeParse({ initialMessage: '' }).success
    ).toBe(false);
  });

  it('REJECTS `voiceProviderAgentId` — the service never read it', () => {
    expect(
      updateVoiceScriptRequestSchema.safeParse({
        voiceProviderAgentId: 'agent_1',
      }).success
    ).toBe(false);
  });

  it('REJECTS the route param `id` and the session `organizationId`', () => {
    expect(
      updateVoiceScriptRequestSchema.safeParse({ id: 'vs_1' }).success
    ).toBe(false);
    expect(
      updateVoiceScriptRequestSchema.safeParse({ organizationId: 'org_1' })
        .success
    ).toBe(false);
  });
});

describe('updateFaceGroupRequestSchema', () => {
  it('accepts a rename-only body (the batch review card)', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ clientName: 'Alice Smith' })
        .success
    ).toBe(true);
  });

  it('accepts a serviceId-only body (the row service picker)', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ serviceId: 'svc_1' }).success
    ).toBe(true);
  });

  it('accepts `serviceId: null` — DETACH the service', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ serviceId: null }).success
    ).toBe(true);
  });

  it('rejects `serviceId: ""` — a blank is not a detach', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ serviceId: '' }).success
    ).toBe(false);
  });

  it('rejects a BLANKED clientName', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ clientName: '' }).success
    ).toBe(false);
  });

  it('REJECTS `isExcluded` — no server schema has ever accepted it', () => {
    expect(
      updateFaceGroupRequestSchema.safeParse({ isExcluded: true }).success
    ).toBe(false);
  });
});

describe('createVideoRequestSchema', () => {
  it('accepts the MINIMUM partial payload (`{ format }`)', () => {
    expect(
      createVideoRequestSchema.safeParse({ format: 'before_after' }).success
    ).toBe(true);
  });

  it('accepts a templateId-only payload', () => {
    expect(
      createVideoRequestSchema.safeParse({ templateId: 'before-after' }).success
    ).toBe(true);
  });

  it('accepts `usageType: organic` — it reaches createVideo now', () => {
    const result = createVideoRequestSchema.safeParse({
      templateId: 'caption-tease',
      usageType: 'organic',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.usageType).toBe('organic');
  });

  it('validates the NESTED draftConfig, not just the envelope', () => {
    expect(
      createVideoRequestSchema.safeParse({
        templateId: 'before-after',
        // `outroOverlayConfigSchema.businessName` is `.min(1)`.
        draftConfig: { outro: { businessName: '' } },
      }).success
    ).toBe(false);
  });

  it('accepts a complete-enough draftConfig verbatim', () => {
    expect(
      createVideoRequestSchema.safeParse({
        title: 'Spring Promo',
        templateId: 'before-after',
        draftConfig: {
          bRollClips: [],
          captions: {
            enabled: true,
            position: 'bottom',
            fontFamily: 'Inter',
            fontSize: 42,
            textColor: '#ffffff',
            highlightColor: '#facc15',
            backgroundColor: '#000000',
            showBackground: true,
          },
          musicVolume: 0.15,
          orientation: 'portrait',
        },
      }).success
    ).toBe(true);
  });

  it('rejects a BLANKED title', () => {
    expect(createVideoRequestSchema.safeParse({ title: '' }).success).toBe(
      false
    );
  });

  it('REJECTS the session context fields', () => {
    expect(
      createVideoRequestSchema.safeParse({ organizationId: 'org_1' }).success
    ).toBe(false);
    expect(
      createVideoRequestSchema.safeParse({ createdById: 'user_1' }).success
    ).toBe(false);
  });
});

describe('updateVideoRequestSchema', () => {
  it('accepts an empty body (a PATCH that changes nothing)', () => {
    expect(updateVideoRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts `serviceId: null` / `offerId: null` — DETACH', () => {
    expect(
      updateVideoRequestSchema.safeParse({ serviceId: null, offerId: null })
        .success
    ).toBe(true);
  });

  it('accepts the wizard-driven render states', () => {
    for (const status of ['draft', 'queued', 'processing', 'ready', 'failed']) {
      expect(updateVideoRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects progress outside 0..100', () => {
    expect(updateVideoRequestSchema.safeParse({ progress: 101 }).success).toBe(
      false
    );
    expect(updateVideoRequestSchema.safeParse({ progress: -1 }).success).toBe(
      false
    );
  });

  it('rejects `blobUrl: ""` — send undefined, not a blank', () => {
    expect(updateVideoRequestSchema.safeParse({ blobUrl: '' }).success).toBe(
      false
    );
  });

  it('draftConfig is a SHALLOW partial — a nested object must be complete', () => {
    expect(
      updateVideoRequestSchema.safeParse({
        draftConfig: { captions: { enabled: true } },
      }).success
    ).toBe(false);
  });

  it('REJECTS the route param `id` in the body', () => {
    expect(updateVideoRequestSchema.safeParse({ id: 'vid_1' }).success).toBe(
      false
    );
  });
});

describe('patchVideoDraftConfigRequestSchema', () => {
  it('MATERIALISES `requeueRender: true` when omitted', () => {
    const result = patchVideoDraftConfigRequestSchema.safeParse({
      patch: { scriptText: 'winter pricing' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requeueRender).toBe(true);
  });

  it('honours an explicit `requeueRender: false` (the clip strip)', () => {
    const result = patchVideoDraftConfigRequestSchema.safeParse({
      patch: { bRollClips: [{ assetId: 'a_1', order: 0 }] },
      requeueRender: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requeueRender).toBe(false);
  });

  // A PATCH endpoint whose job is partial updates rejected a partial nested
  // block, because `.partial()` reaches the top level only. `offerCard` had
  // been partialled by hand, so offer videos could be reworded field-by-field
  // and no other template could — asked to change a Caption Tease headline the
  // server 400'd, and the edit was reported to the owner as unsupported.
  it('accepts a partial organic template block', () => {
    for (const patch of [
      { captionTease: { headline: 'Transform your skin today' } },
      { captionTease: { caption: 'Only three sessions.' } },
      { insOuts: { title: "2026 in's & out's" } },
      { mythFact: { ctaText: 'Book now' } },
      { questionCta: { question: 'Worth it?' } },
    ]) {
      expect(() => partialDraftConfigSchema.parse(patch)).not.toThrow();
    }
  });

  // Documented in the video skill as a supported edit, and equally rejected:
  // `captionConfigSchema` requires all eight of its fields.
  it('accepts a partial captions block', () => {
    expect(() =>
      partialDraftConfigSchema.parse({ captions: { enabled: false } })
    ).not.toThrow();
  });

  // `.partial()` is only meaningful for OBJECT values. The arrays stay
  // wholesale replacements, and a malformed entry must still be refused.
  it('still validates the contents of a partial block', () => {
    expect(() =>
      partialDraftConfigSchema.parse({ captionTease: { headline: '' } })
    ).toThrow();
    expect(() =>
      partialDraftConfigSchema.parse({ bRollClips: [{ order: 0 }] })
    ).toThrow();
  });

  it('accepts a ONE-FIELD offerCard patch — the deep-merge case', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        patch: { offerCard: { headline: 'Half price in March' } },
      }).success
    ).toBe(true);
  });

  it('requires `patch` — an empty body patches nothing', () => {
    expect(patchVideoDraftConfigRequestSchema.safeParse({}).success).toBe(
      false
    );
  });

  it('accepts a clip edit with NO `patch` — clip-only edits are a real case', () => {
    // Requiring `patch: {}` alongside would be ceremony: a clip swap is a
    // complete edit on its own.
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        clipOperations: [{ op: 'swap', index: 1, assetId: 'asset_new' }],
      }).success
    ).toBe(true);
  });

  it('accepts a clip named by `targetAssetId` instead of `index`', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        clipOperations: [{ op: 'remove', targetAssetId: 'asset_old' }],
      }).success
    ).toBe(true);
  });

  it('REJECTS a clip named by BOTH index and targetAssetId', () => {
    // Ambiguous: the two can disagree, and silently preferring one would edit
    // a clip the caller did not mean.
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        clipOperations: [
          { op: 'remove', index: 0, targetAssetId: 'asset_old' },
        ],
      }).success
    ).toBe(false);
  });

  it('REJECTS a clip operation that names NEITHER', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        clipOperations: [{ op: 'remove' }],
      }).success
    ).toBe(false);
  });

  it('REJECTS a swap with no replacement asset', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        clipOperations: [{ op: 'swap', index: 0 }],
      }).success
    ).toBe(false);
  });

  it('REJECTS `whatsappDelivery` — a client cannot address another chat', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        patch: {},
        whatsappDelivery: { conversationId: 'conv_victim' },
      }).success
    ).toBe(false);
  });

  it('REJECTS the route param `videoId` and the session `organizationId`', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        patch: {},
        videoId: 'vid_1',
      }).success
    ).toBe(false);
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        patch: {},
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// draftConfig fidelity — regression guard for the PR-660 hand-lift
// ---------------------------------------------------------------------------

/**
 * `draftConfig` was lifted OUT of
 * `packages/features/src/videos/services/create-video/create-video.schema.ts`
 * and INTO this contract by hand. A grep-based comparison of the two files
 * suggests the lift dropped `testimonial` / `educational` blocks, because those
 * words occur in the feature file and not here.
 *
 * They are NOT draftConfig fields. They are members of `KNOWN_VIDEO_FORMATS` /
 * `VIDEO_FORMAT_TO_TEMPLATE_ID` — the format-alias constants, which correctly
 * stayed in the feature file. A structural (runtime) diff of the two zod trees
 * shows `draftConfigSchema` is unchanged across the lift.
 *
 * These tests pin the behaviour that matters and that a future edit could
 * plausibly break: `draftConfig` is deliberately NOT `.strict()`, so a client
 * running against a newer template set may send a block this schema has never
 * heard of and still get a 2xx — the unknown key is dropped, not rejected. If
 * someone adds `.strict()` here, every wizard running older/newer code starts
 * 400ing, so these must keep passing.
 */
describe('createVideoRequestSchema — draftConfig tolerates undeclared blocks', () => {
  const captions = {
    enabled: true,
    position: 'bottom' as const,
    fontFamily: 'Inter',
    fontSize: 42,
    textColor: '#ffffff',
    highlightColor: '#facc15',
    backgroundColor: '#000000',
    showBackground: true,
  };

  const draftConfig = {
    bRollClips: [],
    captions,
    musicVolume: 0.15,
    orientation: 'portrait' as const,
    scriptText: 'Meet our lead stylist.',
    // Blocks this schema does not declare, keyed by template format.
    testimonial: { quote: 'Best salon in town', author: 'Jo' },
    educational: { steps: ['Cleanse', 'Tone', 'Moisturise'] },
    authority: { credentialLine: '12 years experience' },
  };

  it('ACCEPTS a draftConfig carrying testimonial / educational blocks', () => {
    const result = createVideoRequestSchema.safeParse({
      title: 'Testimonial cut',
      templateId: 'authority',
      draftConfig,
    });
    expect(result.success).toBe(true);
  });

  it('DROPS the undeclared blocks rather than rejecting the request', () => {
    const result = createVideoRequestSchema.safeParse({
      title: 'Testimonial cut',
      templateId: 'authority',
      draftConfig,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.draftConfig).toBeDefined();
    expect(result.data.draftConfig).not.toHaveProperty('testimonial');
    expect(result.data.draftConfig).not.toHaveProperty('educational');
    // The DECLARED fields survive untouched.
    expect(result.data.draftConfig?.scriptText).toBe('Meet our lead stylist.');
    expect(result.data.draftConfig?.orientation).toBe('portrait');
  });

  it('PATCH :id/draft-config tolerates the same undeclared blocks', () => {
    expect(
      patchVideoDraftConfigRequestSchema.safeParse({
        patch: { testimonial: { quote: 'x' }, scriptText: 'y' },
      }).success
    ).toBe(true);
  });
});
