import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE LONG TAIL: forms that are not in the registry yet.
 *
 * For a registered form this check is DEAD — `defineForm` makes it unspellable.
 * A field there cannot be declared without a `default`, because `default` is a
 * required property whose type excludes `undefined`. Property 1 is a compile
 * error, not a test.
 *
 * But the app has many forms that are single-surface and so were never worth
 * registering, and they still hand `useForm` a hand-written `defaultValues`
 * literal. This is the cheap static sweep that keeps THEM honest, and it is why
 * it survived the consolidation rather than being deleted with the other gates:
 * the harness proves things about the 36 forms it knows, and this proves one
 * thing about all the rest.
 *
 * The failure it exists for is a required key ABSENT from `defaultValues` — not
 * an empty one. An empty required field is fine and common (`title: ''` renders
 * an empty input and a normal, actionable "Title is required" error). An ABSENT
 * key means react-hook-form holds no state for it: submit sends `undefined`, and
 * zod reports a type-shaped error ("expected string, received undefined") against
 * a field the user believes is filled in. Invisible in the UI, unfixable by them.
 * It shipped once, in PostContentDialog.
 *
 * THE FIX, when this fires: move the form onto `defineForm`
 * (`@/lib/form-contract/define-form`) and register it. Seeding the missing key by
 * hand silences this, but only `defineForm` stops it coming back.
 */

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Forms with a literal `defaultValues` missing required keys. RATCHET: this set
 * may only shrink. Seed the key (any value — `''`, `[]`, a date) to remove one.
 */
const BASELINE_MISSING = new Set<string>([
  // Dead template code from the calendar library: both real calendars pass their
  // own `customAddDialog` (bookings → ResponsiveAddDialog, content-calendar →
  // AddContentDialog), so this fallback never renders. Delete it rather than fix.
  'components/calendar/components/dialogs/add-event-dialog.tsx',
]);

interface Finding {
  file: string;
  schema: string;
  missing: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Inner text of a balanced pair starting at `openIdx`, plus its end index. */
function balanced(
  src: string,
  openIdx: number,
  open: string,
  close: string
): [string | null, number] {
  if (openIdx < 0) return [null, -1];
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return [src.slice(openIdx + 1, i), i];
    }
  }
  return [null, -1];
}

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const readSrc = (f: string): string => {
  try {
    return stripComments(readFileSync(f, 'utf8'));
  } catch {
    return ''; // virtual file (calibration cases)
  }
};

/** `const NAME = <expr>;` declared in this source, if it is. */
function declSource(name: string, src: string): string | null {
  const decl = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=`));
  if (decl?.index === undefined) return null;
  const rest = src.slice(decl.index);
  const semi = rest.indexOf(';');
  return semi === -1 ? rest : rest.slice(0, semi);
}

/** `key: expr` pairs at depth 0 of an object-literal body. */
function topLevelEntries(body: string): [string, string][] {
  const entries: [string, string][] = [];
  let depth = 0;
  let keyStart = 0;
  const flush = (end: number) => {
    const chunk = body.slice(keyStart, end);
    const m = chunk.match(
      /^\s*(?:'([\w-]+)'|"([\w-]+)"|([A-Za-z_$][\w$]*))\s*:/
    );
    if (m) {
      const key = m[1] ?? m[2] ?? m[3];
      entries.push([key, chunk.slice(chunk.indexOf(':') + 1)]);
    }
    keyStart = end + 1;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) flush(i);
  }
  flush(body.length);
  return entries;
}

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(srcRoot, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // package import — schema lives outside apps/app
  for (const cand of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Source of `const NAME = …`, following imports and barrel re-exports. */
function findSchemaSource(
  name: string,
  file: string,
  seen = new Set<string>()
): { src: string; file: string } | null {
  const key = `${file}#${name}`;
  if (seen.has(key) || seen.size > 12) return null;
  seen.add(key);

  const src = readSrc(file);
  const local = declSource(name, src);
  if (local !== null) return { src: local, file };

  const impRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g;
  let m = impRe.exec(src);
  while (m) {
    const names = m[1].split(',').map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)[0]
        .trim()
    );
    if (names.includes(name)) {
      const target = resolveImport(m[2], file);
      if (target) {
        const found = findSchemaSource(name, target, seen);
        if (found) return found;
        const reRe = /export\s+(?:\*|\{[^}]*\})\s+from\s+'([^']+)'/g;
        let r = reRe.exec(readSrc(target));
        while (r) {
          const via = resolveImport(r[1], target);
          const f2 = via ? findSchemaSource(name, via, seen) : null;
          if (f2) return f2;
          r = reRe.exec(readSrc(target));
        }
      }
    }
    m = impRe.exec(src);
  }
  return null;
}

/**
 * Keys the schema can require at submit: the union of every TOP-LEVEL
 * `z.object({...})` (one per discriminated-union branch), minus
 * `.optional()`/`.nullish()`/`.default()` fields. A `z.object` nested inside a
 * field shapes that field's value, not the form's keys, so it is excluded.
 */
function requiredSchemaKeys(
  schemaSrc: string,
  file: string,
  depth = 0
): Set<string> {
  const required = new Set<string>();
  if (depth > 4 || /\.partial\(\s*\)/.test(schemaSrc)) return required;

  const re = /z\s*\.\s*object\(\s*\{/g;
  const blocks: { start: number; end: number; body: string }[] = [];
  let m = re.exec(schemaSrc);
  while (m) {
    const braceIdx = schemaSrc.indexOf('{', m.index);
    const [body, end] = balanced(schemaSrc, braceIdx, '{', '}');
    if (body !== null) blocks.push({ start: braceIdx, end, body });
    m = re.exec(schemaSrc);
  }
  const topLevel = blocks.filter(
    (b) => !blocks.some((o) => o !== b && o.start < b.start && b.end < o.end)
  );
  for (const block of topLevel) {
    for (const [key, expr] of topLevelEntries(block.body)) {
      if (!/\.optional\(|\.nullish\(|\.default\(|\.catch\(/.test(expr)) {
        required.add(key);
      }
    }
  }

  // `base.extend({...})` / `.merge(base)` — the base's keys are required too.
  const baseRe =
    /([A-Za-z_$][\w$]*)\s*\.\s*(?:extend|merge|omit|pick|superRefine|refine)\s*\(/g;
  let b = baseRe.exec(schemaSrc);
  while (b) {
    if (b[1] !== 'z') {
      const base = findSchemaSource(b[1], file);
      if (base) {
        for (const k of requiredSchemaKeys(base.src, base.file, depth + 1)) {
          required.add(k);
        }
      }
    }
    b = baseRe.exec(schemaSrc);
  }

  // `.omit({ a: true })` drops keys again.
  const omitRe = /\.omit\(\s*\{/g;
  let o = omitRe.exec(schemaSrc);
  while (o) {
    const [body] = balanced(
      schemaSrc,
      schemaSrc.indexOf('{', o.index),
      '{',
      '}'
    );
    if (body !== null) {
      for (const [k] of topLevelEntries(body)) required.delete(k);
    }
    o = omitRe.exec(schemaSrc);
  }

  return required;
}

/** Every `useForm({ resolver: zodResolver(S), defaultValues: {...} })` in a file. */
function analyzeFile(file: string, src?: string): Finding[] {
  const raw = src ? stripComments(src) : readSrc(file);
  const findings: Finding[] = [];

  let idx = raw.indexOf('useForm');
  while (idx !== -1) {
    const after = raw.slice(idx + 'useForm'.length);
    const call = after.match(/^\s*(?:<[^(]*>)?\s*\(/);
    if (!call) {
      idx = raw.indexOf('useForm', idx + 'useForm'.length);
      continue;
    }
    const paren = idx + 'useForm'.length + call[0].length - 1;
    const [callSrc] = balanced(raw, paren, '(', ')');
    idx = raw.indexOf('useForm', paren + 1);
    if (!callSrc) continue;

    const resolver = callSrc.match(/zodResolver\(\s*([A-Za-z_$][\w$]*)/);
    const dvIdx = callSrc.indexOf('defaultValues');
    if (!resolver || dvIdx === -1) continue;

    // Only a literal is analyzable. A shorthand (`defaultValues,`) or a factory
    // call computes the keys elsewhere — and when that factory's return type is
    // the form type, the compiler already guarantees completeness.
    const tail = callSrc.slice(dvIdx + 'defaultValues'.length);
    if (!/^\s*:\s*\{/.test(tail)) continue;

    const [dvBody] = balanced(callSrc, callSrc.indexOf('{', dvIdx), '{', '}');
    if (dvBody === null) continue;
    // A spread could seed anything; don't guess.
    if (/\.\.\./.test(dvBody)) continue;

    // Prefer a schema declared in the source we were handed (covers the inline
    // calibration cases, which have no file on disk).
    const inline = declSource(resolver[1], raw);
    const schema = inline
      ? { src: inline, file }
      : findSchemaSource(resolver[1], file);
    if (!schema) continue;

    const required = requiredSchemaKeys(schema.src, schema.file);
    if (required.size === 0) continue;

    const seeded = new Set(topLevelEntries(dvBody).map(([k]) => k));
    const missing = [...required].filter((k) => !seeded.has(k));
    if (missing.length) {
      findings.push({
        file: relative(srcRoot, file),
        schema: resolver[1],
        missing,
      });
    }
  }
  return findings;
}

describe('form defaults completeness', () => {
  it('detects a required key with no default (calibration — this gate must be able to fail)', () => {
    const buggy = `
      const schema = z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('now'), title: z.string() }),
        z.object({ mode: z.literal('schedule'), title: z.string(), date: z.string(), time: z.string() }),
      ]);
      const form = useForm<Data>({
        resolver: zodResolver(schema),
        defaultValues: { mode: 'now', title: '' },
      });
    `;
    const [finding] = analyzeFile(join(srcRoot, 'calibration.tsx'), buggy);
    expect(finding?.missing.sort()).toEqual(['date', 'time']);
  });

  it('treats a present-but-empty default as seeded', () => {
    const ok = `
      const schema = z.object({ title: z.string().min(1), tags: z.array(z.string()) });
      const form = useForm<Data>({
        resolver: zodResolver(schema),
        defaultValues: { title: '', tags: [] },
      });
    `;
    expect(analyzeFile(join(srcRoot, 'calibration.tsx'), ok)).toEqual([]);
  });

  it('every form seeds a default for each key its schema can require', () => {
    const findings = walk(srcRoot).flatMap((f) => analyzeFile(f));
    const offenders = findings.filter((f) => !BASELINE_MISSING.has(f.file));

    expect(
      offenders.map((f) => `${f.file} → missing: ${f.missing.join(', ')}`)
    ).toEqual([]);

    // Ratchet: a baselined file that now passes must leave the baseline.
    const stillFailing = new Set(findings.map((f) => f.file));
    const stale = [...BASELINE_MISSING].filter((f) => !stillFailing.has(f));
    expect(stale, 'fixed — remove from BASELINE_MISSING').toEqual([]);
  });
});
