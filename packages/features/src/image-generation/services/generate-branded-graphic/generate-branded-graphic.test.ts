import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import sharp from 'sharp';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as geminiImageModule from '../../gemini-image.js';
import * as logoVariantsModule from '../../logo-variants.js';
import * as resolveSlotImageModule from '../resolve-slot-image/index.js';
import { generateBrandedGraphic } from './generate-branded-graphic.service.js';

describe('generateBrandedGraphic', () => {
  const mockDb = createMockDatabase();
  let callGeminiImage: ReturnType<typeof vi.spyOn>;
  let resolveSlotImage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    callGeminiImage = vi.spyOn(geminiImageModule, 'callGeminiImage');
    callGeminiImage.mockResolvedValue({
      success: true,
      data: { png: Buffer.from('fake-png'), model: 'test-gemini-model' },
    });
    resolveSlotImage = vi.spyOn(resolveSlotImageModule, 'resolveSlotImage');
    resolveSlotImage.mockResolvedValue({
      success: true,
      data: { url: '', source: 'no-resolution', imagery: { kind: 'none' } },
    });
  });

  afterEach(() => {
    callGeminiImage.mockRestore();
    resolveSlotImage.mockRestore();
  });

  it('returns VALIDATION_ERROR when serviceId is missing', async () => {
    await expectResult(
      generateBrandedGraphic(
        mockDb as never,
        {
          organizationId: 'org_1',
          topic: 'before & after',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when topic is empty', async () => {
    await expectResult(
      generateBrandedGraphic(
        mockDb as never,
        {
          organizationId: 'org_1',
          serviceId: 'svc_1',
          topic: '',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('does not ask Gemini to invent service photos in template mode when AI images are disabled', async () => {
    mockBrandAndServiceRows();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      inspirationImageBase64: Buffer.from('template-layout').toString('base64'),
      layoutPrompt: 'Use the reference layout with a full-bleed photo area.',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('invented imagery is not permitted');
    expect(prompt).toContain('Do NOT invent or generate people');
    expect(prompt).toContain('abstract texture');
    expect(prompt).not.toContain('compose a fitting image yourself');
  });

  it('allows generated service photos in template mode only when AI images are explicitly enabled', async () => {
    mockBrandAndServiceRows();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      inspirationImageBase64: Buffer.from('template-layout').toString('base64'),
      layoutPrompt: 'Use the reference layout with a full-bleed photo area.',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: true,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    // Assert the PERMISSION, not the wording — this used to pin the exact
    // phrase "compose a fitting beauty/treatment image", which broke when the
    // directive was reworded to prefer a room or a texture over an invented
    // person. The behaviour under test is that invention is allowed at all.
    expect(prompt).toContain('compose a fitting image yourself');
    expect(prompt).not.toContain('invented imagery is not permitted');
    expect(prompt).not.toContain('AI images are off');
  });

  /**
   * The brand's own posts are the palette; a stored hex is not.
   *
   * `primary_color` is populated for all 94 production orgs, which is what gives
   * it away as a default rather than a decision: 14 sit on #7c3aed (Tailwind
   * violet-600), 8 on #7a00df, 12 on #000000 — about a third of the estate on
   * three generic values. The prompt used to declare that hex "authoritative"
   * and say it "takes precedence", so for those orgs it instructed the model to
   * override real evidence of the brand with an app default.
   */
  it("does not push a stored brand colour over the brand's own reference posts", async () => {
    mockBrandAndServiceRows();
    // The reference has to actually LOAD — an unfetchable URL yields zero
    // references, which is the other branch entirely.
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(new Uint8Array(png), { status: 200 }) as never
      );

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      brandPrimaryColor: '#FF0000',
      styleReferenceUrls: ['https://example.com/post-1.jpg'],
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.referenceCount).toBe(1);

    const prompt = lastGeminiPrompt();
    expect(prompt).not.toContain('takes precedence');
    expect(prompt).not.toContain('BRAND PRIMARY COLOUR (authoritative)');
    expect(prompt).toContain('BRAND example posts');
    fetchSpy.mockRestore();
  });

  /**
   * A photo the owner PICKED must actually reach the model, and must be
   * described as mandatory once it gets there.
   *
   * Both halves had failed. The picker preselected up to ten images while a
   * single render attaches exactly one, and the instruction that introduced it
   * was gated — "only add a photo if the layout actually has a photographic
   * area", closing with an explicit licence to skip the photo on a type-only
   * layout. So the owner chose a photograph and the model was told it could
   * leave it out, which is what "it ignored my picture" actually was.
   */
  it('sends an owner-picked photo to Gemini and makes placing it mandatory', async () => {
    mockBrandAndServiceRows();
    const fetchSpy = await mockLoadableReference();
    resolveSlotImage.mockResolvedValue({
      success: true,
      data: {
        url: 'https://example.com/owner-photo.jpg',
        source: 'service-asset',
        consumedAssetId: 'asset_1',
        imagery: {
          kind: 'org-asset',
          url: 'https://example.com/owner-photo.jpg',
        },
      },
    });

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      sourceAssetIds: ['asset_1'],
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);

    // The bitmap is genuinely attached — not merely described in the prompt.
    expect(lastGeminiImages().length).toBeGreaterThan(0);

    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('MUST appear in this graphic');
    expect(prompt).toContain('ADAPT it so the photograph fits');
    // The escape hatches are gone for a picked photo.
    expect(prompt).not.toContain(
      'only add a photo if the layout actually has a photographic area'
    );
    expect(prompt).not.toContain('do NOT add any photo at all');
    fetchSpy.mockRestore();
  });

  it('leaves a resolver-found photo deferring to the layout', async () => {
    // The mandate is for images the owner NAMED. A photo the resolver merely
    // found still yields to a type-only layout, or every text-led graphic in
    // the estate grows a photograph it was never designed around.
    mockBrandAndServiceRows();
    const fetchSpy = await mockLoadableReference();
    resolveSlotImage.mockResolvedValue({
      success: true,
      data: {
        url: 'https://example.com/found-photo.jpg',
        source: 'service-asset',
        consumedAssetId: 'asset_9',
        imagery: {
          kind: 'org-asset',
          url: 'https://example.com/found-photo.jpg',
        },
      },
    });

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).not.toContain('MUST appear in this graphic');
    expect(prompt).toContain('Place the PROVIDED photograph');
    fetchSpy.mockRestore();
  });

  it('uses the primary colour directly when no style guide exists', async () => {
    mockBrandAndServiceRows();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('Use #123456 as the brand colour');
  });

  it('renders ONE canonical handle from the Instagram link, ignoring the website (ENG-542)', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        {
          name: 'Glitter Girls Beauty',
          logo: null,
          brandFontImageUrl: null,
          brandStyleGuide: null,
          primaryColor: '#123456',
          websiteUrl: 'https://glittergirlsbeauty.ie',
          chatbotSettings: {
            instagramLink: 'https://instagram.com/GlitterGirlsBeauty',
          },
        },
      ])
      .mockResolvedValueOnce([
        { name: 'Powder Brows', description: null, targetArea: 'Brows' },
      ]);

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    // The IG handle wins over the website domain and is normalised to "@handle".
    expect(prompt).toContain('render it EXACTLY as "@GlitterGirlsBeauty"');
    expect(prompt).not.toContain('glittergirlsbeauty.ie');
  });

  it('falls back to the website domain when there is no Instagram link (ENG-542)', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        {
          name: 'Glitter Girls Beauty',
          logo: null,
          brandFontImageUrl: null,
          brandStyleGuide: null,
          primaryColor: '#123456',
          websiteUrl: 'https://www.glittergirlsbeauty.ie/book',
          chatbotSettings: null,
        },
      ])
      .mockResolvedValueOnce([
        { name: 'Powder Brows', description: null, targetArea: 'Brows' },
      ]);

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    // Bare domain: protocol, www and path all stripped.
    expect(prompt).toContain('render it EXACTLY as "glittergirlsbeauty.ie"');
  });

  it('omits the handle bar entirely when the org has no handle or website (ENG-542)', async () => {
    mockBrandAndServiceRows(); // no websiteUrl / chatbotSettings → null handle

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('leave it out entirely');
    expect(prompt).not.toContain('render it EXACTLY as');
  });

  it('locks one type system across every slide of a carousel (ENG-542)', async () => {
    mockBrandAndServiceRows(); // no font ref, no style guide

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
      isCarouselSlide: true,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('TYPOGRAPHY');
    expect(prompt).toContain('IDENTICAL fonts on every slide');
    // No font ref + no style guide → the fixed serif/sans pairing keeps the
    // whole deck internally consistent instead of drifting per reference.
    expect(prompt).toContain('high-contrast serif for headings');
  });

  it('forbids re-typesetting the business name as a logo substitute (ENG-542)', async () => {
    mockBrandAndServiceRows();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('Never re-type the business name');
    expect(prompt).toContain('no trailing "+"');
  });

  it('does not read the pre-rebrand inspiration image to pick the logo polarity (ENG-542)', async () => {
    mockBrandAndServiceRows();
    const luminance = vi.spyOn(logoVariantsModule, 'imageLuminanceFromBase64');

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Powder brows',
      inspirationImageBase64: Buffer.from('template-layout').toString('base64'),
      layoutPrompt: 'Full-bleed portrait with the logo at the top.',
      logoLightBase64: Buffer.from('logo-light').toString('base64'),
      logoDarkBase64: Buffer.from('logo-dark').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    // With no real subject photo we assume a light background rather than
    // reading the dark reference screenshot's tone — so no luminance read at all
    // and the contrasting (dark) logo is chosen, never vanishing.
    expect(luminance).not.toHaveBeenCalled();
    luminance.mockRestore();
  });

  /**
   * CAPABILITY: a brand with NO logo must not get an invented one.
   *
   * A blanket "do not draw a logo" instruction already existed and still lost,
   * because the machine-distilled `brand_style_guide` was injected into the same
   * prompt and, for some orgs, DESCRIBED the mark. Camden Beauty Spa's
   * production guide read "Gold is used exclusively for the logo crown", "small
   * gold crown/logo lockup at top centre" and "Every graphic includes the logo"
   * — with no logo on file. Given a general prohibition and a specific visual
   * instruction, the model followed the specific one: the same crown motif every
   * render, redrawn each time, reported by the owner as "our logo keeps being
   * altered". 41 of 43 production guides mentioned a logo or a layout.
   *
   * The fix is upstream of the prohibition: the distilled prose no longer
   * reaches the model at all. So the assertion is that a guide's text CANNOT
   * appear in the prompt, whatever it says — a prohibition that has to out-argue
   * a conflicting instruction is a weaker guarantee than not carrying the
   * instruction.
   */
  it('never lets a stored style guide describe a logo into the prompt', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        {
          name: 'Camden Beauty Spa',
          logo: null,
          brandFontImageUrl: null,
          brandStyleGuide:
            'Gold is used exclusively for the logo crown. Small gold crown/logo lockup at top centre. Every graphic includes the logo.',
          primaryColor: '#ff6900',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'Glow Peel',
          description: 'A resurfacing peel',
          targetArea: 'Face',
        },
      ])
      // With no logo passed in, `ensureLogoVariants` reads the org row itself —
      // and finds no logo, which is the state under test.
      .mockResolvedValueOnce([{ logo: null }]);

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Glow Peel',
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();

    // The guide's own wording is absent. ("crown" and "lockup" on their own are
    // not usable as markers — the prohibition legitimately lists both as things
    // NOT to draw, so these assert the guide's distinctive phrasing instead.)
    expect(prompt).not.toContain('Gold is used exclusively');
    expect(prompt).not.toContain('top centre');
    expect(prompt).not.toContain('Every graphic includes the logo');

    // The prohibition still stands on its own for an org with no logo.
    expect(prompt).toContain('NO LOGO IS AVAILABLE');
  });

  it('does NOT emit the no-logo override when a logo is supplied', async () => {
    // The override must not leak into the normal path — telling a model both
    // "reproduce this logo exactly" and "no logo is available" is the same
    // contradiction in reverse.
    mockBrandAndServiceRows();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).not.toContain('NO LOGO IS AVAILABLE');
    expect(prompt).toContain('reproduce it EXACTLY');
  });

  function mockBrandAndServiceRows() {
    mockDb.limit
      .mockResolvedValueOnce([
        {
          name: 'Bare Clinic',
          logo: null,
          brandFontImageUrl: null,
          brandStyleGuide: null,
          primaryColor: '#123456',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'Botox',
          description: 'A wrinkle-relaxing injectable treatment',
          targetArea: 'Face',
        },
      ]);
  }

  /**
   * PROSE AND THE DESIGN MODEL MUST COEXIST.
   *
   * `templateMode` is true whenever there is a layout at all — screenshot OR
   * prose — and the design-model directive used to be gated on it. So sending
   * the template's prose silently evicted the brand's own posts as the design
   * model, which is the whole reason suppressing the prose ever looked like an
   * improvement: the comparison was never prose-vs-no-prose, it was
   * prose-without-the-brand vs brand-without-a-layout.
   *
   * The screenshot still evicts it, and should: a curated screenshot IS a
   * finished design, and two design models produce a recompose.
   */
  it('keeps the brand as the design model when the layout arrives as PROSE', async () => {
    mockBrandAndServiceRows();
    const fetchSpy = await mockLoadableReference();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      layoutPrompt: 'Three short paragraphs stacked with generous spacing.',
      styleReferenceUrls: ['https://example.com/post-1.jpg'],
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).toContain('THE BRAND EXAMPLE POST IS YOUR DESIGN MODEL');
    // Both directives now ship together, so the prompt has to say which wins
    // where rather than leaving two absolute-sounding instructions to fight.
    expect(prompt).toContain('PRECEDENCE:');
    fetchSpy.mockRestore();
  });

  it('still lets a curated SCREENSHOT displace the design model', async () => {
    mockBrandAndServiceRows();
    const fetchSpy = await mockLoadableReference();

    const result = await generateBrandedGraphic(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      topic: 'Botox myths',
      inspirationImageBase64: Buffer.from('template-layout').toString('base64'),
      layoutPrompt: 'Three short paragraphs stacked with generous spacing.',
      styleReferenceUrls: ['https://example.com/post-1.jpg'],
      logoLightBase64: Buffer.from('logo').toString('base64'),
      allowAiImages: false,
    });

    expect(result.success).toBe(true);
    const prompt = lastGeminiPrompt();
    expect(prompt).not.toContain('THE BRAND EXAMPLE POST IS YOUR DESIGN MODEL');
    expect(prompt).not.toContain('PRECEDENCE:');
    fetchSpy.mockRestore();
  });

  async function mockLoadableReference() {
    // An unfetchable URL yields zero references, which is a different branch.
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .png()
      .toBuffer();
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(new Uint8Array(png), { status: 200 }) as never
      );
  }

  /**
   * THE PRIOR IMAGE MUST REACH THE MODEL.
   *
   * Nothing covered this, and a refactor deleted the whole block — both the
   * URL fetch and the in-memory path — while 7,700 tests stayed green. The
   * failure is silent by construction: with no prior image the model has
   * nothing to edit, so a "change one word" request quietly becomes a full
   * re-roll and the only symptom is a graphic that looks different.
   */
  describe('prior image', () => {
    it('sends prior bytes to the model and treats the render as an amendment', async () => {
      mockBrandAndServiceRows();
      // These take the no-layout path, which reads one row more than the
      // template-mode tests above.
      mockDb.limit.mockResolvedValue([]);
      const prior = Buffer.from('previous-render').toString('base64');

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        priorImageBase64: prior,
        refinementInstruction: 'change the headline',
      });

      expect(result.success).toBe(true);
      expect(lastGeminiImages().some((i) => i.data === prior)).toBe(true);
      expect(lastGeminiPrompt()).toContain('PREVIOUS version of this graphic');
    });

    it('introduces the prior image as a SIBLING when building the next slide', async () => {
      // A sibling is not an amendment: nothing about the reference is being
      // changed, and this slide is expected to differ from it. Sharing the
      // amendment wording made the model reproduce the reference's copy.
      mockBrandAndServiceRows();
      mockDb.limit.mockResolvedValue([]);
      const sibling = Buffer.from('slide-1').toString('base64');

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        priorImageBase64: sibling,
        regenerationIntent: 'sibling',
      });

      expect(result.success).toBe(true);
      expect(lastGeminiImages().some((i) => i.data === sibling)).toBe(true);
      const prompt = lastGeminiPrompt();
      expect(prompt).toContain('FINISHED SLIDE');
      expect(prompt).toContain('Keep its BACKGROUND exactly');
      // It must NOT be told to reproduce the reference wholesale.
      expect(prompt).not.toContain('change ONLY the wording requested below');
    });
  });

  /**
   * A DECK'S COLOUR AND ITS COMPOSITION ARE DIFFERENT DECISIONS.
   *
   * The predecessor to this named a category ("this brand works on a PALE
   * ground"), fired only when the org had a brand corpus, and folded layout
   * into the same switch — `photo-led` meant "a photograph fills most of the
   * frame". So choosing a full-bleed cover meant giving up the deck's palette,
   * and the 37 orgs with no corpus were told nothing at all.
   */
  describe('deck ground', () => {
    it('states the ground as a colour and still permits a full bleed', async () => {
      mockBrandAndServiceRows();
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        deckGroundColour: '#7d5a63',
      });

      expect(result.success).toBe(true);
      const prompt = lastGeminiPrompt();
      expect(prompt).toContain('#7d5a63');
      expect(prompt).toContain('bleed to all four edges');
      expect(prompt).toContain('do NOT take the ground from a photograph');
    });

    it('says nothing about a ground when none was resolved', async () => {
      mockBrandAndServiceRows();
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
      });

      expect(result.success).toBe(true);
      expect(lastGeminiPrompt()).not.toContain('DECK GROUND');
    });
  });

  /**
   * The "font reference" is usually a finished post, and on a briefed deck
   * nothing competes with it — two of five slides came back carrying its
   * photograph, one reprinting "Salon owner & founder" as slide copy.
   */
  describe('font reference', () => {
    it('is NOT sent to a briefed render, which has no layout to compete with it', async () => {
      // Two prompt wordings failed to stop the model building from this image.
      // The gate is the fix; the deck ground already reads its palette without
      // showing it to the model.
      mockDb.limit
        .mockResolvedValueOnce([
          {
            name: 'Bare Clinic',
            logo: null,
            brandFontImageUrl: 'https://cdn.example/font.jpg',
            brandStyleGuide: null,
            primaryColor: '#123456',
          },
        ])
        .mockResolvedValueOnce([
          { name: 'Botox', description: 'A treatment', targetArea: 'Face' },
        ]);
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        // no layoutPrompt — this is a briefed slide
      });

      expect(result.success).toBe(true);
      expect(lastGeminiPrompt()).not.toContain('TYPE SPECIMEN');
    });

    it('is introduced as a type specimen whose content is off limits', async () => {
      mockDb.limit
        .mockResolvedValueOnce([
          {
            name: 'Bare Clinic',
            logo: null,
            brandFontImageUrl: 'https://cdn.example/font.jpg',
            brandStyleGuide: null,
            primaryColor: '#123456',
          },
        ])
        .mockResolvedValueOnce([
          { name: 'Botox', description: 'A treatment', targetArea: 'Face' },
        ]);
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        layoutPrompt: 'An offer badge over a photo, price bottom-right.',
      });

      expect(result.success).toBe(true);
      const prompt = lastGeminiPrompt();
      // Only asserted when the reference actually loaded; a fetch failure is
      // not what this test is about.
      if (prompt.includes('TYPE SPECIMEN')) {
        expect(prompt).toContain('do NOT reproduce its photograph');
        expect(prompt).not.toContain(
          'render ALL text in the typeface shown here'
        );
      }
    });
  });

  /**
   * CONTENT-SAFETY RULES DO NOT RIDE ON A LAYOUT SOURCE.
   *
   * `RULE_NO_BEFORE_AFTER` and `RULE_NO_REFERENCE_PHOTOS` used to reach the
   * model only inside `TEMPLATE_STRUCTURE_PREAMBLE`, which was prepended to a
   * composition template's `layoutPrompt`. Deleting the carousel registry
   * therefore removed both from every organic deck — silently, because a
   * missing prohibition has no symptom until the model happens to do the thing.
   *
   * It did: a healing-timeline cover came back as a before/after pair of a real
   * client's brows, and the gate's correction could not fix it because the
   * request it was correcting still contained no rule against it.
   */
  describe('content-safety rules', () => {
    it('bans fabricated before/after pairs with no layout present', async () => {
      mockBrandAndServiceRows();
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'The powder brow healing timeline, day by day',
        // A briefed slide: no layoutPrompt, no inspiration screenshot.
      });

      expect(result.success).toBe(true);
      const prompt = lastGeminiPrompt();
      expect(prompt).toContain('NEVER produce a BEFORE/AFTER pair');
      expect(prompt).toContain('never reproduce a reference');
    });

    it('bans them on a layout-bearing render too', async () => {
      mockBrandAndServiceRows();
      mockDb.limit.mockResolvedValue([]);

      const result = await generateBrandedGraphic(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        topic: 'Botox myths',
        layoutPrompt: 'A headline over a photo.',
      });

      expect(result.success).toBe(true);
      expect(lastGeminiPrompt()).toContain('NEVER produce a BEFORE/AFTER pair');
    });
  });

  function lastGeminiPrompt(): string {
    expect(callGeminiImage).toHaveBeenCalledTimes(1);
    const [args] = callGeminiImage.mock.calls[0];
    return (args as { prompt: string }).prompt;
  }

  function lastGeminiImages(): { data: string; mediaType: string }[] {
    expect(callGeminiImage).toHaveBeenCalledTimes(1);
    const [args] = callGeminiImage.mock.calls[0];
    return (
      (args as { images?: { data: string; mediaType: string }[] }).images ?? []
    );
  }
});
