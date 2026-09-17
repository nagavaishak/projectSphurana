import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type RegenerationIntent,
  amendmentDirective,
  inferRegenerationIntent,
  inputsForIntent,
} from './regeneration-intent.js';

/**
 * CAPABILITY TESTS.
 *
 * These do not check that the code does what it currently does — they pin the
 * inputs each capability DEPENDS ON, so removing one fails the build instead of
 * reaching a customer.
 *
 * The regression that motivated them: "changing the headline changes the whole
 * image" was fixed by withholding the subject photo on every amendment, which
 * made "change the background image" impossible — the new photo could no
 * longer reach the model. Nothing failed. The route stayed reachable, the tool
 * kept its `sourceAssetIds` parameter, and the endpoint-coverage gate stayed
 * green, because it grades whether Claire can REACH a route, not what the
 * route still does.
 *
 * Each test below names the capability it protects.
 */
describe('regeneration capabilities', () => {
  describe('capability: change the copy, keep the picture', () => {
    it('sends the previous render — without it the edit is a re-roll', () => {
      expect(inputsForIntent('copy').priorImage).toBe(true);
    });

    it('withholds the references that redefine composition', () => {
      // Both carry their own "reproduce this structure faithfully"
      // instruction, which competes with the prior render. Given two
      // references claiming the composition, the model composes a third thing.
      const inputs = inputsForIntent('copy');
      expect(inputs.layoutInspiration).toBe(false);
      expect(inputs.brandExample).toBe(false);
    });

    it('names the photography as fixed, so it cannot drift', () => {
      expect(amendmentDirective('copy')).toMatch(/same photography/i);
      expect(amendmentDirective('copy')).toMatch(/only the wording/i);
    });
  });

  describe('capability: change the picture, keep the copy', () => {
    it('sends the subject photo — THIS is the regression guard', () => {
      // Withholding it made the swap silently impossible: resolveSlotImage was
      // skipped, so the newly chosen photo never reached the model.
      expect(inputsForIntent('image').subjectPhoto).toBe(true);
    });

    it('sends the previous render so everything else is preserved', () => {
      expect(inputsForIntent('image').priorImage).toBe(true);
    });

    it('names the photography as the thing that changes', () => {
      // The `copy` directive would actively fight this intent — it pins the
      // photography — so the two must not share wording.
      const directive = amendmentDirective('image');
      expect(directive).toMatch(/replace the photography/i);
      expect(directive).toMatch(/do not reword/i);
      expect(directive).not.toMatch(/same photography/i);
    });
  });

  describe('capability: full regeneration still composes freshly', () => {
    it('uses the curated layout and brand reference', () => {
      // Amendments withhold these; a fresh composition needs them, or every
      // graphic drifts off-template and off-brand.
      const inputs = inputsForIntent('full');
      expect(inputs.layoutInspiration).toBe(true);
      expect(inputs.brandExample).toBe(true);
    });

    it('does not anchor to a previous render', () => {
      expect(inputsForIntent('full').priorImage).toBe(false);
    });

    it('has no amendment directive', () => {
      expect(amendmentDirective('full')).toBeNull();
    });
  });

  describe('invariants across every intent', () => {
    const intents: RegenerationIntent[] = ['copy', 'image', 'full'];

    it('always sends the brand assets', () => {
      // Without the logo the model invents a wordmark — a separate,
      // long-running complaint that no intent may reintroduce.
      for (const intent of intents) {
        expect(inputsForIntent(intent).brandAssets).toBe(true);
      }
    });

    it('always sends some source of imagery', () => {
      // An intent that sends neither the prior render nor a photo leaves the
      // model to invent the subject, which customers explicitly reject
      // ("only use real pictures of me").
      for (const intent of intents) {
        const inputs = inputsForIntent(intent);
        expect(inputs.priorImage || inputs.subjectPhoto).toBe(true);
      }
    });

    it('never mixes a prior render with a competing composition reference', () => {
      // The rule that makes amendments behave. Stated once, checked for all.
      for (const intent of intents) {
        const inputs = inputsForIntent(intent);
        if (!inputs.priorImage) continue;
        expect(inputs.layoutInspiration).toBe(false);
        expect(inputs.brandExample).toBe(false);
      }
    });
  });

  describe('inference (compatibility shim for callers without an intent)', () => {
    it('treats a supplied photo as an image change', () => {
      expect(
        inferRegenerationIntent({
          hasPriorImage: true,
          explicitSourceAssetIds: ['asset_1'],
          refinementInstruction: 'use this one instead',
        })
      ).toBe('image');
    });

    it('treats a bare instruction as a copy change', () => {
      expect(
        inferRegenerationIntent({
          hasPriorImage: true,
          refinementInstruction: 'change the headline',
        })
      ).toBe('copy');
    });

    it('falls back to a full regeneration with no prior render', () => {
      expect(
        inferRegenerationIntent({
          hasPriorImage: false,
          refinementInstruction: 'change the headline',
        })
      ).toBe('full');
    });

    it('treats a blank instruction as no instruction', () => {
      expect(
        inferRegenerationIntent({
          hasPriorImage: true,
          refinementInstruction: '   ',
        })
      ).toBe('full');
    });
  });
});
