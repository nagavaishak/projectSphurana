import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type ImagerySource,
  imageryPolicyFromLegacyFlags,
  imageryPolicyValues,
  policyAcceptsGenericStock,
  policyAllowsAi,
  policyAllowsOwnAssets,
  policyAllowsStock,
  sourceIsAuthentic,
  sourceSuppliesImage,
} from './imagery-policy.js';

describe('imageryPolicyFromLegacyFlags', () => {
  it('treats an unspecified stock flag as stock-on, matching the old default', () => {
    expect(imageryPolicyFromLegacyFlags({})).toBe('own-then-stock');
  });

  it('backstops stock with AI when both are permitted', () => {
    // The defect this whole type exists for. Both flags on used to mean "run
    // stock first and never reach AI", so the model got an irrelevant stock
    // photograph AND permission to invent one, and the concrete image won.
    const policy = imageryPolicyFromLegacyFlags({
      allowAiImages: true,
      allowStockImages: true,
    });
    expect(policy).toBe('own-then-stock-then-ai');
    // Stock may still answer — but only when it actually matches.
    expect(policyAllowsStock(policy)).toBe(true);
    expect(policyAcceptsGenericStock(policy)).toBe(false);
    expect(policyAllowsAi(policy)).toBe(true);
  });

  it('gives AI a stock-free policy when stock is explicitly off', () => {
    const policy = imageryPolicyFromLegacyFlags({
      allowAiImages: true,
      allowStockImages: false,
    });
    expect(policy).toBe('own-then-ai');
    expect(policyAllowsStock(policy)).toBe(false);
  });

  it('only the plain stock policy accepts an ambient-pool clip', () => {
    // The ambient pool answers almost always, and frequently with something
    // unrelated. A policy that can invent instead must not take it.
    expect(policyAcceptsGenericStock('own-then-stock')).toBe(true);
    expect(policyAcceptsGenericStock('own-then-stock-then-ai')).toBe(false);
  });

  it('falls to own-only when stock is explicitly off and AI is not asked for', () => {
    expect(imageryPolicyFromLegacyFlags({ allowStockImages: false })).toBe(
      'own-only'
    );
  });

  it('lets a suppressed subject photo override everything else', () => {
    const policy = imageryPolicyFromLegacyFlags({
      allowAiImages: true,
      allowStockImages: true,
      suppressSubjectPhoto: true,
    });
    expect(policy).toBe('text-led');
    expect(policyAllowsOwnAssets(policy)).toBe(false);
    expect(policyAllowsAi(policy)).toBe(false);
  });

  it('permits the org own assets under every policy except text-led', () => {
    for (const p of imageryPolicyValues) {
      expect(policyAllowsOwnAssets(p)).toBe(p !== 'text-led');
    }
  });
});

describe('ImagerySource provenance', () => {
  const orgAsset: ImagerySource = {
    kind: 'org-asset',
    url: 'https://cdn/a.jpg',
    assetId: 'a1',
    isVideoFrame: false,
    candidateAssetIds: ['a1'],
    rotationPoolSize: 1,
    excludedForQuality: 0,
  };
  const stock: ImagerySource = {
    kind: 'stock',
    url: 'https://cdn/s.jpg',
    stockClipId: 's1',
  };

  it('counts stock as supplying an image but NOT as the business own work', () => {
    // These two answers used to be the same boolean. That is how a stock IV
    // drip came to be described to the model as "the REAL service photo".
    expect(sourceSuppliesImage(stock)).toBe(true);
    expect(sourceIsAuthentic(stock)).toBe(false);
  });

  it('counts an uploaded asset as both', () => {
    expect(sourceSuppliesImage(orgAsset)).toBe(true);
    expect(sourceIsAuthentic(orgAsset)).toBe(true);
  });

  it('supplies no image for the two photo-less outcomes', () => {
    expect(sourceSuppliesImage({ kind: 'model-invented' })).toBe(false);
    expect(sourceSuppliesImage({ kind: 'none' })).toBe(false);
    expect(sourceIsAuthentic({ kind: 'model-invented' })).toBe(false);
  });
});

describe('the monthly batch policy', () => {
  it('backstops with AI rather than accepting an ambient stock clip', () => {
    // The batch pinned `allowAiImages: false` on the reasoning that it should
    // never invent imagery. That resolves to `own-then-stock`, which ACCEPTS
    // the ambient pool — the tier that served an IV drip for a cryotherapy
    // facial. "No invented imagery" was buying wrong imagery.
    const policy = imageryPolicyFromLegacyFlags({ allowAiImages: true });
    expect(policy).toBe('own-then-stock-then-ai');
    expect(policyAcceptsGenericStock(policy)).toBe(false);
    expect(policyAllowsAi(policy)).toBe(true);
  });

  it('the OLD batch setting is the one that takes ambient stock', () => {
    const old = imageryPolicyFromLegacyFlags({ allowAiImages: false });
    expect(old).toBe('own-then-stock');
    expect(policyAcceptsGenericStock(old)).toBe(true);
  });
});
