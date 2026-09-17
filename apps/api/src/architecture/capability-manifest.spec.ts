/**
 * CI staleness guard for the generated capability manifest.
 *
 * The prompt Claire runs on consumes a COMMITTED artifact
 * (`packages/features/src/assistant/skills/capability-manifest.generated.ts`)
 * because the prompt lives in a package that cannot import `apps/api`. This
 * spec re-renders the artifact from the current coverage.ts files and asserts
 * the committed file matches — so a coverage change (a tool added, removed, or
 * re-graded) that isn't regenerated fails the build, and the "can do / can't
 * do" statement can never silently drift from the real tool set.
 *
 * Fix a failure with:
 *   pnpm --filter @borradh-workspace/api gen:capability-manifest
 */

import { readFileSync } from 'node:fs';
import {
  GENERATED_MANIFEST_PATH,
  renderGeneratedModule,
} from './capability-manifest.artifact.js';
import {
  KNOWN_ABSENCES,
  buildCapabilityData,
  renderCapabilityManifest,
} from './capability-manifest.js';

describe('capability manifest', () => {
  it('committed artifact is up to date with coverage.ts', () => {
    const onDisk = readFileSync(GENERATED_MANIFEST_PATH, 'utf8');
    expect(onDisk).toBe(renderGeneratedModule());
  });

  it('exposes the chatbot kill switch and directive editor', () => {
    const text = renderCapabilityManifest();
    expect(text).toContain('chatbots: setDirective, setEnabled');
  });

  it('states the sequence absence (#9 — a capability Claire lacks)', () => {
    const text = renderCapabilityManifest();
    expect(text.toLowerCase()).toContain('sequence');
    expect(text).toContain('I can’t');
  });

  it('lists tone memory as a capability (#66 — a capability Claire has)', () => {
    // `meta_remember` is always-loaded, not in a coverage.ts, so the manifest
    // is not the only signal for #66 — but the grouped "I can" list must still
    // reflect the real exposed set, and the chatbot toggle is the Phase 8 add.
    const { groups } = buildCapabilityData();
    const features = groups.map((g) => g.feature);
    expect(features).toContain('chatbots');
  });

  it('throws if a KNOWN_ABSENCES line is contradicted by an exposed tool', () => {
    // Guard integrity: every absence must have a specific contradiction regex,
    // so the day a tool ships for it, generation fails loudly.
    for (const absence of KNOWN_ABSENCES) {
      expect(absence.contradictedBy).toBeInstanceOf(RegExp);
      expect(absence.text.length).toBeGreaterThan(20);
    }
    // buildCapabilityData throws on contradiction; today it must NOT throw.
    expect(() => buildCapabilityData()).not.toThrow();
  });
});
