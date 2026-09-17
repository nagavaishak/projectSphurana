/**
 * Pull the first complete JSON object out of a model reply.
 *
 * ## Why this is not `text.slice(indexOf('{'), lastIndexOf('}') + 1)`
 *
 * That was the shared idiom in all three vision gates, and it is wrong whenever
 * the model says anything after the JSON. A reply of
 *
 *     { "pass": false, "issues": [ … ] }
 *
 *     The graphic otherwise looks fine (no other issues to report}
 *
 * slices from the first `{` to the LAST `}` — swallowing the prose — and
 * `JSON.parse` fails with "Unexpected non-whitespace character after JSON".
 * Observed in production on `inspectGraphic`.
 *
 * The consequence is worse than a crash: every gate treats a parse failure as
 * "no opinion" and ships the graphic. So a model that becomes slightly chattier
 * — because someone lengthened its instructions, say — silently turns the
 * quality gate off for a fraction of renders, and nothing looks broken.
 *
 * Scanning for the matching brace fixes it at the source. String-aware, because
 * a `}` inside a quoted defect description is not a closing brace, and defect
 * descriptions quote the rendered copy.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      // Only meaningful inside a string, but harmless outside one.
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced — a truncated reply. Better to report "no opinion" than to
  // guess at where the object was meant to end.
  return null;
}
