/**
 * Canonical mock for `node:dns/promises`.
 *
 * Aliased in vite.config.ts so every test file sees the *same* `lookup` mock —
 * a prerequisite for `isolate: false`. Previously both `html.test.ts` and
 * `analyze-website.test.ts` did a file-local `vi.mock('node:dns/promises', …)`;
 * under the shared worker graph those two factories bound `assertExternalUrl`
 * (in html.ts) to a *different* `lookup` instance than the one each test drove,
 * so html.ts's DNS-resolved-host tests flaked depending on file order.
 *
 * Default resolves to a public IP so any incidental caller of `assertExternalUrl`
 * is allowed. Tests that need specific resolution import `lookup` and drive it
 * with `vi.mocked()` (re-establishing the impl in their own `beforeEach`, since
 * a sibling test file may have reset the shared mock). See the MAINTENANCE RULE
 * in vite.config.ts.
 */
import { vi } from 'vitest';

export const lookup = vi
  .fn()
  .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
