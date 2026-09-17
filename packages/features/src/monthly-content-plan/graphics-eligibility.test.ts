import { describe, expect, it } from '@borradh-workspace/testing';
import { canPlanGraphics } from './graphics-eligibility.js';

describe('canPlanGraphics', () => {
  it('allows graphics when a selected service has an uploaded image', () => {
    expect(
      canPlanGraphics({ hasUploadedImage: true, allowStockFootage: false })
    ).toBe(true);
  });

  it('allows graphics with NO uploaded image when stock is permitted', () => {
    // The regression this exists to prevent. Two separate gates encoded
    // "a graphic needs an uploaded image", which stopped being true once
    // resolve-slot-image gained its stock-image and ai-generated tiers. An org
    // with no uploaded photo asked for six graphics and silently got none.
    expect(
      canPlanGraphics({ hasUploadedImage: false, allowStockFootage: true })
    ).toBe(true);
  });

  it('refuses graphics with no image and no stock consent', () => {
    // Declining stock must decline stock stills and generated imagery too, not
    // just footage.
    expect(
      canPlanGraphics({ hasUploadedImage: false, allowStockFootage: false })
    ).toBe(false);
  });

  it('allows graphics when both hold', () => {
    expect(
      canPlanGraphics({ hasUploadedImage: true, allowStockFootage: true })
    ).toBe(true);
  });
});
