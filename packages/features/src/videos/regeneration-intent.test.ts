import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type VideoRegenerationIntent,
  inferVideoRegenerationIntent,
  inputsForVideoIntent,
} from './regeneration-intent.js';

/**
 * CAPABILITY TESTS.
 *
 * These do not check that the code does what it currently does — they pin the
 * inputs each capability DEPENDS ON, so removing one fails the build instead of
 * reaching a customer.
 *
 * The regression that motivated them is the video half of the graphics one:
 * `plan-video-detail` reused the caption and the idea on a regenerate but
 * re-claimed the b-roll every time, so "make the headline shorter" returned a
 * video with different footage. Nothing failed — the route stayed reachable
 * and the regeneration object kept all its fields. The capability just did not
 * exist.
 *
 * Each test below names the capability it protects.
 */
describe('video regeneration capabilities', () => {
  describe('capability: change the copy, keep the footage', () => {
    it('re-uses the previous clips — without this the edit is a re-roll', () => {
      // Clip selection stamps `lastUsedAt` as it claims, so a re-claim is
      // actively steered AWAY from the clips the original used. Reuse is the
      // only thing that makes a copy edit an edit.
      expect(inputsForVideoIntent('copy').reuseClips).toBe(true);
    });

    it('refines the copy rather than writing it fresh', () => {
      const inputs = inputsForVideoIntent('copy');
      expect(inputs.refineCopy).toBe(true);
      // Without the prior copy a headline change also reissues body and CTA.
      expect(inputs.reuseCopyVerbatim).toBe(false);
    });

    it('pins the template, so the layout cannot drift', () => {
      // Template choice otherwise hashes the fresh video id. A different
      // template also implies a different clip count, which would make
      // reuseClips unsatisfiable.
      expect(inputsForVideoIntent('copy').pinTemplate).toBe(true);
    });

    it('keeps the caption and idea the user already reviewed', () => {
      const inputs = inputsForVideoIntent('copy');
      expect(inputs.reuseCaption).toBe(true);
      expect(inputs.reuseIdea).toBe(true);
    });
  });

  describe('capability: change the footage, keep the words', () => {
    it('releases the previous clips so the claim returns something else', () => {
      expect(inputsForVideoIntent('footage').reuseClips).toBe(false);
    });

    it('carries the copy across VERBATIM — a footage swap must not reword', () => {
      const inputs = inputsForVideoIntent('footage');
      expect(inputs.reuseCopyVerbatim).toBe(true);
      // Distinct from refineCopy: one rewrites deliberately, the other
      // refuses to touch it. Regenerating here would make "use different
      // clips" silently reword the video.
      expect(inputs.refineCopy).toBe(false);
    });

    it('pins the template — swapping footage is not a redesign', () => {
      expect(inputsForVideoIntent('footage').pinTemplate).toBe(true);
    });
  });

  describe('capability: start again', () => {
    it('preserves nothing — full is a fresh plan, not an amendment', () => {
      const inputs = inputsForVideoIntent('full');
      expect(inputs.reuseClips).toBe(false);
      expect(inputs.reuseCopyVerbatim).toBe(false);
      expect(inputs.refineCopy).toBe(false);
      expect(inputs.reuseCaption).toBe(false);
      expect(inputs.reuseIdea).toBe(false);
      expect(inputs.pinTemplate).toBe(false);
    });
  });

  describe('the two edit intents are genuinely different', () => {
    it('copy and footage disagree on every axis they exist to control', () => {
      const copy = inputsForVideoIntent('copy');
      const footage = inputsForVideoIntent('footage');
      // If these ever converge, one of the intents has stopped working while
      // both remain callable — the exact failure mode this module prevents.
      expect(copy.reuseClips).not.toBe(footage.reuseClips);
      expect(copy.refineCopy).not.toBe(footage.refineCopy);
      expect(copy.reuseCopyVerbatim).not.toBe(footage.reuseCopyVerbatim);
    });

    it('never rewrites and preserves copy at the same time', () => {
      // Mutually exclusive by construction: one rewrites, the other forbids
      // touching it. Both true is incoherent and would silently pick one.
      for (const intent of ['copy', 'footage', 'full'] as const) {
        const i = inputsForVideoIntent(intent);
        expect(i.refineCopy && i.reuseCopyVerbatim).toBe(false);
      }
    });

    it('only pins the template when it also preserves something', () => {
      // A pinned template on a full re-roll would be an arbitrary constraint.
      for (const intent of ['copy', 'footage', 'full'] as const) {
        const i = inputsForVideoIntent(intent);
        const preservesSomething =
          i.reuseClips || i.reuseCopyVerbatim || i.reuseCaption || i.reuseIdea;
        if (i.pinTemplate) expect(preservesSomething).toBe(true);
      }
    });
  });

  describe('inference shim for callers that predate the field', () => {
    it('treats an instruction with known prior clips as a copy edit', () => {
      expect(
        inferVideoRegenerationIntent({
          hasPriorClipIds: true,
          refinementInstruction: 'make the headline shorter',
        })
      ).toBe('copy');
    });

    it('honours an explicit request for different footage', () => {
      expect(
        inferVideoRegenerationIntent({
          hasPriorClipIds: true,
          requestedFootageChange: true,
          refinementInstruction: 'use different clips',
        })
      ).toBe('footage');
    });

    it('falls back to full when no prior clips were carried', () => {
      // Degrades to today's behaviour rather than claiming to preserve footage
      // it was never given.
      expect(
        inferVideoRegenerationIntent({
          hasPriorClipIds: false,
          refinementInstruction: 'make the headline shorter',
        })
      ).toBe('full');
    });

    it('is full when nothing was asked for', () => {
      expect(inferVideoRegenerationIntent({ hasPriorClipIds: true })).toBe(
        'full'
      );
    });
  });

  describe('every intent is in the table', () => {
    it('has inputs for each declared intent', () => {
      const intents: VideoRegenerationIntent[] = ['copy', 'footage', 'full'];
      for (const intent of intents) {
        expect(inputsForVideoIntent(intent)).toBeDefined();
      }
    });
  });
});
