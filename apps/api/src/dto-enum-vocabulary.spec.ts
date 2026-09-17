/**
 * GATE: a DTO may not hand-type a vocabulary that lives in
 * `@borradh-workspace/labels`.
 *
 * Why this exists
 * ---------------
 * 235 DTO files, and until now **not one** of them derived its enums. They
 * hand-typed `z.enum(['facebook', 'instagram', ...])`, and nine of those copies
 * had silently fallen behind the real vocabulary. Five were live
 * UI-can-send / API-rejects pairs: the lead form's `source` select is correctly
 * derived from `leadSourceValues` (8 values) while `PUT /leads/:id` hand-typed
 * 6 — so a lead that arrived from a Meta lead form or WhatsApp could not be
 * edited AT ALL, because the update payload sends the lead's own `source` back
 * and the API 400'd on it.
 *
 * The rule this gate encodes
 * --------------------------
 * A gate's input must be DERIVED from the artifact it checks. So:
 *
 *   - the DTO enums are enumerated by PARSING every file under
 *     `apps/api/src/**\/dto/**` with the TypeScript AST (not a hand-kept list);
 *   - the vocabularies are enumerated by READING every `*Labels` record
 *     exported from `@borradh-workspace/labels` at runtime (not a hand-kept
 *     list).
 *
 * A DTO enum whose values are a subset of some vocabulary is a restatement of
 * that vocabulary, and it fails — either as a *strict* subset (the bug class:
 * the UI can produce a value the API rejects) or as an exact restatement (the
 * copy that becomes the next strict subset the day someone adds a value).
 *
 * The only escape is an explicit, reasoned entry in DELIBERATELY_NARROWER
 * below, which a human reads in review.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as labels from '@borradh-workspace/labels';
import ts from 'typescript';

const API_SRC = resolve(__dirname);
const REPO_DTO_GLOB_ROOT = API_SRC;

// ---------------------------------------------------------------------------
// DELIBERATELY NARROWER — the ONLY escape hatch.
//
// An entry says: "this DTO knowingly accepts fewer values than the vocabulary,
// and here is why." Anything not listed here must derive the full vocabulary.
// Entries are matched on (file, field, vocabulary); a stale entry that no
// longer matches any DTO enum fails the suite too, so this list cannot rot.
// ---------------------------------------------------------------------------
interface NarrowerEntry {
  /** path relative to apps/api/src */
  file: string;
  /** the object property the z.enum() is assigned to */
  field: string;
  /** the `*Labels` export it is a subset of */
  vocabulary: string;
  /** why the API deliberately accepts less than the UI vocabulary */
  reason: string;
}

const DELIBERATELY_NARROWER: NarrowerEntry[] = [
  {
    file: 'microsites/dto/get-microsite-document.dto.ts',
    field: 'mode',
    vocabulary: 'socialPostStatusLabels',
    reason:
      'Coincidental value overlap, not a shared vocabulary. This is which ' +
      'VERSION of a microsite document to read — the working draft, or the ' +
      'published revision snapshot — and it has nothing to do with the ' +
      'lifecycle of a social post. Deriving from socialPostStatusValues would ' +
      'make `scheduled`, `publishing`, `partial` and `failed` legal values of ' +
      'a read mode that has no meaning for any of them. The two vocabularies ' +
      'happen to share the words draft and published; that is all.',
  },
  {
    file: 'chatbots/dto/test-chat.dto.ts',
    field: 'role',
    vocabulary: 'assistantMessageRoleLabels',
    reason:
      'These are Vercel AI SDK `UIMessage` roles posted by the chatbot test panel, ' +
      'not the persisted assistant-message vocabulary. The client never sends a ' +
      '`tool` message — tool results are produced server-side — so accepting one ' +
      'would let a caller forge a tool result. The overlap with ' +
      'assistantMessageRoleLabels is incidental, so this stays a literal.',
  },
];

// ---------------------------------------------------------------------------
// Derive the vocabularies: every `*Labels` record exported by the labels package.
// ---------------------------------------------------------------------------
interface Vocabulary {
  name: string;
  values: string[];
}

const vocabularies: Vocabulary[] = Object.entries(
  labels as Record<string, unknown>
)
  .filter(([name]) => name.endsWith('Labels'))
  .flatMap(([name, record]) => {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      return [];
    const entries = Object.entries(record as Record<string, unknown>);
    if (entries.length === 0) return [];
    // A label record is `{ enumValue: 'Display Text' }`.
    if (!entries.every(([, v]) => typeof v === 'string')) return [];
    return [{ name, values: entries.map(([k]) => k) }];
  });

// ---------------------------------------------------------------------------
// Derive the DTO enums: parse every DTO file and pull out each
// `z.enum([ ...string literals ])` with the property it is assigned to.
// ---------------------------------------------------------------------------
interface DtoEnum {
  file: string; // relative to apps/api/src
  field: string;
  values: string[];
  line: number;
}

const listDtoFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listDtoFiles(full));
    } else if (
      full.endsWith('.ts') &&
      !full.endsWith('.spec.ts') &&
      /[/\\]dto[/\\]/.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
};

/** Nearest enclosing object-literal property name, e.g. `source: z.enum([...])`. */
const enclosingFieldName = (node: ts.Node): string => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Stop climbing once we leave the object literal we're describing.
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    current = current.parent;
  }
  return '<unknown>';
};

const collectDtoEnums = (file: string): DtoEnum[] => {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: DtoEnum[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'enum' &&
      node.arguments.length === 1 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      const arr = node.arguments[0] as ts.ArrayLiteralExpression;
      const allStrings = arr.elements.every((e) => ts.isStringLiteral(e));
      if (allStrings && arr.elements.length > 0) {
        found.push({
          file: relative(API_SRC, file),
          field: enclosingFieldName(node),
          values: arr.elements.map((e) => (e as ts.StringLiteral).text),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
};

const dtoFiles = listDtoFiles(REPO_DTO_GLOB_ROOT);
const dtoEnums = dtoFiles.flatMap(collectDtoEnums);

// ---------------------------------------------------------------------------
// The check.
// ---------------------------------------------------------------------------
const isSubsetOf = (values: string[], vocab: Vocabulary): boolean =>
  values.every((v) => vocab.values.includes(v));

interface Violation {
  dto: DtoEnum;
  vocabulary: Vocabulary;
  kind: 'strict-subset' | 'restatement';
  missing: string[];
}

const findViolations = (enums: DtoEnum[]): Violation[] => {
  const violations: Violation[] = [];
  for (const dto of enums) {
    for (const vocab of vocabularies) {
      if (!isSubsetOf(dto.values, vocab)) continue;
      const missing = vocab.values.filter((v) => !dto.values.includes(v));
      const exempt = DELIBERATELY_NARROWER.some(
        (e) =>
          e.file === dto.file &&
          e.field === dto.field &&
          e.vocabulary === vocab.name
      );
      if (exempt) continue;
      violations.push({
        dto,
        vocabulary: vocab,
        kind: missing.length > 0 ? 'strict-subset' : 'restatement',
        missing,
      });
    }
  }
  return violations;
};

const describeViolation = (v: Violation): string =>
  v.kind === 'strict-subset'
    ? `  ${v.dto.file}:${v.dto.line}  field \`${v.dto.field}\`\n    z.enum([${v.dto.values.map((x) => `'${x}'`).join(', ')}])\n    is a STRICT SUBSET of \`${v.vocabulary.name}\` — the UI can send ${v.missing.map((x) => `'${x}'`).join(', ')} and this DTO 400s on it.\n    Fix: z.enum(${v.vocabulary.name.replace(/Labels$/, 'Values')})  (or add a DELIBERATELY_NARROWER entry with a reason).`
    : `  ${v.dto.file}:${v.dto.line}  field \`${v.dto.field}\`\n    restates the whole \`${v.vocabulary.name}\` vocabulary by hand. It is correct today and will drift tomorrow.\n    Fix: z.enum(${v.vocabulary.name.replace(/Labels$/, 'Values')}).`;

describe('DTO enums derive from the labels vocabulary', () => {
  it('enumerates DTO files and label vocabularies (sanity: the gate has input)', () => {
    // If either of these is empty the gate is a decoration.
    expect(dtoFiles.length).toBeGreaterThan(100);
    expect(vocabularies.length).toBeGreaterThan(50);
  });

  it('no DTO hand-types a vocabulary that lives in @borradh-workspace/labels', () => {
    const violations = findViolations(dtoEnums);

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} DTO enum(s) restate or narrow a labels vocabulary:\n\n${violations.map(describeViolation).join('\n\n')}\n\nA gate\'s input must be derived. If you type a list, you are writing the next bug.`
      );
    }

    expect(violations).toEqual([]);
  });

  it('every DELIBERATELY_NARROWER entry still matches a real DTO enum (no stale exemptions)', () => {
    const stale = DELIBERATELY_NARROWER.filter((entry) => {
      const vocab = vocabularies.find((v) => v.name === entry.vocabulary);
      if (!vocab) return true;
      return !dtoEnums.some(
        (dto) =>
          dto.file === entry.file &&
          dto.field === entry.field &&
          isSubsetOf(dto.values, vocab) &&
          dto.values.length < vocab.values.length
      );
    });

    expect(stale.map((s) => `${s.file}#${s.field} ⊂ ${s.vocabulary}`)).toEqual(
      []
    );
  });

  it('every DELIBERATELY_NARROWER entry carries a reason a human can review', () => {
    for (const entry of DELIBERATELY_NARROWER) {
      expect(entry.reason.trim().length).toBeGreaterThan(30);
    }
  });
});
