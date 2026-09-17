import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './endpoint-coverage.js';

/**
 * Static enumeration of ASSERTED tool responses — every `ctx.apiFetch<T>(…)`
 * call whose shape is a promise rather than a check.
 *
 * This is the input to Gate 4 in `docs/engineering/capability-architecture.md`.
 *
 * WHY IT EXISTS
 * -------------
 * `apiFetch<T>` does not connect `T` to the endpoint in any way. It is the
 * caller telling the compiler what comes back. Two shipped defects came from
 * exactly that:
 *
 *   - `meta_ads_generateAdCopy` asserted `{ headline }` on an envelope that
 *     nests the copy under `content`, so every field read `undefined` and the
 *     tool returned all-null copy with an OK status on 100% of calls.
 *   - `context_listServices` asserted `pricingDescription`, which is not a
 *     column on `organization_service` (they are `priceText` / `priceType` /
 *     `priceCents`), so it reported null pricing for every service, always.
 *
 * Both were structurally valid, and both had unit tests that mocked the SAME
 * wrong shape — the author's belief written twice. The only thing that catches
 * this class statically is DERIVING the response type from a contracts schema
 * so `tsc` owns the field names, which is what `apiFetch(path, { schema })`
 * does.
 *
 * WHAT THIS GATE CANNOT KNOW
 * --------------------------
 * It cannot say "a schema exists for this endpoint and you ignored it". There
 * is no endpoint→schema map in the repo (only 4 routes carry
 * `@ResponseContract`), and inferring one from a URL template would be a guess.
 * So the gate makes the weaker, checkable claim: *this call site asserts rather
 * than parses*. That is enough to make new tools derive by default and to turn
 * the legacy assertions into a visible, shrinking number.
 *
 * It also cannot check the hand-composed projections in
 * `packages/contracts/src/responses/` against what the server actually sends.
 * Column names are anchored (those schemas extend GENERATED atoms), but added
 * fields — `hasGraphicMedia`, `variants` — are somebody's belief. Only a real
 * HTTP round trip in `apps/api/src/_integration` catches that. This gate stops
 * reader-vs-schema drift; nothing static stops schema-vs-server drift.
 *
 * Deliberately static (regex over source), like `api-surface.ts`: the gate must
 * run in a plain unit-test process with no DB, no env and no DI graph.
 */

export const TOOLS_DIR = path.join(REPO_ROOT, 'apps/api/src/assistant/tools');
export const PORTS_ADAPTER_DIR = path.join(
  REPO_ROOT,
  'apps/api/src/assistant/ports'
);

export interface AssertedResponse {
  /** Stable identity: `repo/relative/file.ts:LINE`. */
  id: string;
  /** Repo-relative file path. */
  file: string;
  /** 1-indexed line number of the `apiFetch<` token. */
  line: number;
  /** The asserted type argument, trimmed. `{` when it is an inline object. */
  typeArg: string;
}

/**
 * `apiFetch<` preceded by anything (`ctx.apiFetch<`, `this.apiFetch<`, a bare
 * `apiFetch<`). The type argument itself is read by brace/angle matching rather
 * than regex, because inline object types nest.
 */
const ASSERTED_RE = /\bapiFetch\s*</;

function collectSourceFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      acc.push(full);
    }
  }
}

/** Read the type argument starting at the `<`, balancing `<>`, `{}` and `()`. */
function readTypeArg(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '<' || ch === '{' || ch === '(') depth += 1;
    else if (ch === '>' || ch === '}' || ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i).trim();
    }
  }
  return text.slice(openIndex + 1).trim();
}

/**
 * Every `apiFetch<T>` call under the assistant's tool and adapter trees.
 *
 * Spec files are excluded: a test may legitimately assert a shape to build a
 * mock, and forcing derivation there would only push the belief into a cast.
 */
export function collectAssertedResponses(): AssertedResponse[] {
  const files: string[] = [];
  collectSourceFiles(TOOLS_DIR, files);
  collectSourceFiles(PORTS_ADAPTER_DIR, files);
  files.sort();

  const found: AssertedResponse[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((lineText, index) => {
      const match = ASSERTED_RE.exec(lineText);
      if (!match) return;
      // Re-find the `<` in the whole-file text so a multi-line inline object
      // type is read in full, not truncated at the newline.
      const lineStart = lines
        .slice(0, index)
        .reduce((n, l) => n + l.length + 1, 0);
      const openIndex = lineStart + lineText.indexOf('<', match.index);
      found.push({
        id: `${rel}:${index + 1}`,
        file: rel,
        line: index + 1,
        typeArg: readTypeArg(source, openIndex).startsWith('{')
          ? '{'
          : readTypeArg(source, openIndex),
      });
    });
  }
  return found;
}
