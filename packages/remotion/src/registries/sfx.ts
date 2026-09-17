// SFX registry stub (§9, P2.13).
//
// TODO: sfx storage home open — see docs/plans/video-template-engine-remaining.md §9.
// The library doesn't have a decided home yet:
//   - Static woff2-style bundling under @borradh-workspace/remotion would
//     work for a small curated set but bloats the worker bundle.
//   - S3 + per-org curation matches how media assets work but needs a control
//     plane (rule out for v1).
//   - A hybrid (a tiny built-in set + an open string for org-supplied URLs)
//     is the leading candidate; that's why sfxRef on the token side is
//     z.string() rather than a closed enum.
//
// Until the library lands, the resolver throws. Templates that author against
// sfx tokens are gate-failed by the synthesizer (which won't have a way to
// resolve them).

import type { SfxToken } from '@borradh-workspace/video-templates';

export interface SfxEntry {
  url: string;
  defaultVolume: number;
}

export function getSfx(_token: SfxToken): SfxEntry {
  throw new Error(
    'sfx registry not yet implemented — storage home undecided (see docs/plans/video-template-engine-remaining.md §9 / P2.13)'
  );
}
