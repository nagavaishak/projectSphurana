import { describe, expect, it } from '@borradh-workspace/testing';
import type { OrgDefaults } from '../../../org-defaults/index.js';
import { synthesizeDraftConfig } from './synthesize-draft-config.js';

const baseDefaults: OrgDefaults = {
  organizationId: 'org-1',
  adDailyBudgetCents: 1000,
  adObjective: 'OUTCOME_LEADS',
  videoOrientation: 'portrait',
  videoLengthSecs: 60,
  brandVoice: null,
  defaultServiceIdForAds: null,
};

describe('synthesizeDraftConfig', () => {
  // `before-after` was the default until it was retired (RETIRED_TEMPLATE_IDS).
  // An unnamed format must never fall back to a withdrawn one.
  it('defaults to authority when nothing supplied', () => {
    const result = synthesizeDraftConfig({ orgDefaults: baseDefaults });

    expect(result.templateId).toBe('authority');
    expect(result.variationId).toBe('authority-1');
    expect(result.draftConfig.orientation).toBe('portrait');
    expect(result.draftConfig.bRollClips).toEqual([]);
    expect(result.draftConfig.captions.enabled).toBe(true);
    expect(result.draftConfig.outro.businessName).toBe('');
    expect(result.draftConfig.musicVolume).toBeGreaterThan(0);
  });

  // The alias still resolves, but the target template is retired, so it must
  // degrade to the safe default rather than produce a withdrawn format.
  it('declines the retired before_after alias and falls back to the default', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      format: 'before_after',
    });
    expect(result.templateId).toBe('authority');
  });

  it('maps talking_head alias to authority template', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      format: 'talking_head',
    });
    expect(result.templateId).toBe('authority');
  });

  it('prefers explicit templateId over format alias', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      format: 'before_after',
      templateId: 'authority',
    });
    expect(result.templateId).toBe('authority');
  });

  it('seeds title from service name when provided', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      service: { id: 'svc-1', name: 'Non-Surgical Facelift' },
    });
    expect(result.title).toContain('Non-Surgical Facelift');
  });

  it('seeds script from service description when provided', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      service: {
        id: 'svc-1',
        name: 'ENDYMED',
        description: 'Non-invasive skin tightening.',
      },
    });
    expect(result.draftConfig.scriptText).toBe('Non-invasive skin tightening.');
  });

  it('forces portrait when the org default is landscape (no-landscape rule)', () => {
    // Per user directive 2026-05-17 — synthesised drafts never render
    // landscape, even when the org default says otherwise. Landscape is
    // reserved for the wizard flow which provides a complete draftConfig
    // and bypasses this synthesiser.
    const result = synthesizeDraftConfig({
      orgDefaults: { ...baseDefaults, videoOrientation: 'landscape' },
    });
    expect(result.draftConfig.orientation).toBe('portrait');
  });

  it('respects square when the org default is square', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: { ...baseDefaults, videoOrientation: 'square' },
    });
    expect(result.draftConfig.orientation).toBe('square');
  });

  it('defaults to portrait when the org default is unset', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: { ...baseDefaults, videoOrientation: 'portrait' },
    });
    expect(result.draftConfig.orientation).toBe('portrait');
  });

  it('uses organization businessName + logoUrl in outro', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      organization: {
        name: 'Acme Clinic',
        logoUrl: 'https://cdn/logo.png',
      },
    });
    expect(result.draftConfig.outro.businessName).toBe('Acme Clinic');
    expect(result.draftConfig.outro.logoUrl).toBe('https://cdn/logo.png');
  });

  it('applies caller overrides on top of synthesized defaults', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      overrides: {
        scriptText: 'Custom script',
        captions: { enabled: false } as never,
      },
    });
    expect(result.draftConfig.scriptText).toBe('Custom script');
    expect(result.draftConfig.captions.enabled).toBe(false);
    // Other caption fields preserved from defaults
    expect(result.draftConfig.captions.position).toBe('bottom');
  });

  it('falls back to the default template when format is unknown', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      format: 'nonsense-format',
    });
    expect(result.templateId).toBe('authority');
  });

  it('declines an explicit retired templateId', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      templateId: 'before-after',
    });
    expect(result.templateId).toBe('authority');
  });

  it('always returns a complete draftConfig (no required fields missing)', () => {
    const result = synthesizeDraftConfig({ orgDefaults: baseDefaults });
    // Spot-check every required field per draftConfigSchema
    expect(result.draftConfig.bRollClips).toBeDefined();
    expect(result.draftConfig.captions).toBeDefined();
    expect(result.draftConfig.musicVolume).toBeDefined();
    expect(result.draftConfig.outro).toBeDefined();
    expect(result.draftConfig.orientation).toBeDefined();
  });

  it('respects an explicit variationId', () => {
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      templateId: 'educational',
      variationId: 'educational-2',
    });
    expect(result.variationId).toBe('educational-2');
  });

  // A text_only draft with no textFrames (and no offer/organic block) is the
  // exact state the v1 worker rejects mid-render, wedging the BullMQ queue
  // (PostHog issue 019ed0cc). Synth is the single funnel for one-prompt drafts,
  // so it must NEVER emit a content-less text_only draft — even when the script
  // seed is blank. The fallback derives a frame from the title / business name.
  it('always emits at least one textFrame for a text_only draft', () => {
    // educational-1 has narrationMode: text_only.
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      templateId: 'educational',
      variationId: 'educational-1',
    });
    expect(result.draftConfig.narrationType).toBe('text_only');
    expect(result.draftConfig.textFrames?.length ?? 0).toBeGreaterThan(0);
  });

  it('falls back to a non-empty textFrame when the script seed is blank', () => {
    // No service description and an override that blanks the script seed: the
    // fallback must still produce a renderable frame (from the business name /
    // template title) so the draft never reaches the worker content-less.
    const result = synthesizeDraftConfig({
      orgDefaults: baseDefaults,
      templateId: 'educational',
      variationId: 'educational-1',
      organization: { name: 'Glow Clinic' },
      overrides: { scriptText: '' },
    });
    expect(result.draftConfig.narrationType).toBe('text_only');
    expect(result.draftConfig.textFrames?.length ?? 0).toBeGreaterThan(0);
  });
});
