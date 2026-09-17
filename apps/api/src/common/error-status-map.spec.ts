/**
 * GATE: one error code, one HTTP status.
 *
 * The API has ~80 hand-copied `mapError` / `mapErrorToHttpException` switches.
 * Nothing kept them in agreement, and most of them switch on BARE STRING
 * LITERALS rather than the enum — so renaming a code silently stops the case
 * matching, it falls through to `default` and the caller gets a 500, with no
 * compiler error anywhere.
 *
 * The bug that motivated this gate: `META_AUTH_EXPIRED` mapped to 401 in
 * `meta-ads.controller.ts` and 409 in `meta-campaigns.controller.ts`. The
 * frontend's api-client does `if (error.status === 401) clearAuthToken()`, so a
 * user whose *Meta* token expired got logged out of *Borradh* — via one route
 * but not the other, purely by which file the mapper had been copy-pasted into.
 *
 * The gate's inputs are DERIVED, never typed by hand:
 *   - codes    ← every `*ErrorCodes` object in packages/features/src
 *   - emitters ← every reference to one of those codes in non-controller source
 *   - mappers  ← every `*.controller.ts`, parsed with the TypeScript AST so all
 *                three in-tree mapper styles are seen:
 *                  A. `{ CODE: HttpStatus.X, [ErrorCodes.Y]: HttpStatus.Z }`
 *                  B. `switch (error.code) { case 'CODE': ... }`
 *                  C. `if (error.code === CODE) throw new HttpException(…)`
 *
 * It fails on:
 *   (a) one code mapped to two different statuses,
 *   (b) a code emitted by a service but mapped by no controller,
 *   (c) a code mapped by a controller but emitted by nothing (dead),
 *   (d) a mapper key that is not a real error code at all (a typo),
 *   (e) the parser going blind (a controller that maps errors but yields none).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const REPO = join(__dirname, '../../../..');
const FEATURES_SRC = join(REPO, 'packages/features/src');
const API_SRC = join(REPO, 'apps/api/src');

/**
 * Codes that a service emits but NO controller maps, deliberately, because they
 * never travel over HTTP. Each needs a reason a human reads in review. This is
 * a ratchet, not a dumping ground: a stale entry (one that IS now mapped, or is
 * no longer emitted) fails the gate too.
 */
const NOT_HTTP_SURFACED: Record<string, string> = {
  AI_MODEL_REFUSED:
    'Only reachable from the image-generation services, which are invoked exclusively by the video-worker BullMQ processor (graphic-generate-processor.ts). It surfaces as a failed/retried job, never as an HTTP response.',
  STRIPE_WEBHOOK_ERROR:
    'The poison-event path. The Stripe webhook controllers deliberately ACK this with a 2xx so Stripe stops redelivering an event that a retry cannot fix (the failure is logged for manual replay). Mapping it to a 4xx/5xx would make Stripe retry it forever.',
  INSUFFICIENT_CREDITS_TO_PUBLISH:
    'Emitted only by activate-sequence, whose controller was deleted along with the rest of the sequences HTTP surface. packages/features/src/sequences/ survives that deletion because leadActivity and the lead-history join still live in its schema file, so the code is still EMITTED — but nothing can reach it over HTTP any more. This exemption is temporary by construction: when the features package goes, check (b) stops reporting the code and the honesty check below forces this line out.',
  MISSING_INTEGRATIONS:
    'Same as INSUFFICIENT_CREDITS_TO_PUBLISH — an activate-sequence precondition with no mounted route left to serve it. Deliberately NOT re-mapped onto some surviving controller: inventing a mapping would assert an HTTP surface that does not exist. Removed automatically once packages/features/src/sequences/ is deleted.',
};

// ---------------------------------------------------------------- fs helpers

const walk = (dir: string, pred: (p: string) => boolean): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(p, pred));
    } else if (pred(p)) {
      out.push(p);
    }
  }
  return out;
};

const parse = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );

const isTestFile = (p: string) => /\.(test|spec|int-spec)\.ts$/.test(p);
const rel = (p: string) => relative(REPO, p);

// ------------------------------------------------- 1. declared codes (derived)

/** code -> the `*ErrorCodes` enums that declare it */
const declaredCodes = new Map<string, Set<string>>();
/** the files that DECLARE an enum — a reference here is not an emission */
const declarationFiles = new Set<string>();

const featureFiles = walk(
  FEATURES_SRC,
  (p) => p.endsWith('.ts') && !isTestFile(p)
);

for (const file of featureFiles) {
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /ErrorCodes$/.test(node.name.text) &&
      node.initializer
    ) {
      const init = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        declarationFiles.add(file);
        for (const prop of init.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isStringLiteral(prop.initializer)
          ) {
            const code = prop.initializer.text;
            if (!declaredCodes.has(code)) declaredCodes.set(code, new Set());
            declaredCodes.get(code)?.add(node.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
}

/** `'CODE'` or `SomeErrorCodes.CODE` -> `'CODE'` */
const codeFromExpression = (expr: ts.Expression | undefined): string | null => {
  if (!expr) return null;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (
    ts.isPropertyAccessExpression(expr) &&
    /ErrorCodes$/.test(expr.expression.getText())
  ) {
    return expr.name.text;
  }
  return null;
};

// -------------------------------------------------- 2. emitted codes (derived)

/** code -> files that can produce it */
const emittedCodes = new Map<string, Set<string>>();
const recordEmit = (code: string, file: string) => {
  if (!emittedCodes.has(code)) emittedCodes.set(code, new Set());
  emittedCodes.get(code)?.add(rel(file));
};

const emitterFiles = [
  ...featureFiles.filter((f) => !declarationFiles.has(f)),
  ...walk(
    API_SRC,
    (p) => p.endsWith('.ts') && !isTestFile(p) && !p.endsWith('.controller.ts')
  ),
];

for (const file of emitterFiles) {
  const visit = (node: ts.Node): void => {
    // Any `SomeErrorCodes.CODE` reference outside a declaration file. This is
    // deliberately broad: codes also travel through lookup tables (e.g. Meta's
    // `CATEGORY_ERROR_CODE`), not only `new FeatureError(CODE, …)`.
    if (
      ts.isPropertyAccessExpression(node) &&
      /ErrorCodes$/.test(node.expression.getText()) &&
      declaredCodes.has(node.name.text)
    ) {
      recordEmit(node.name.text, file);
    }
    // `new FeatureError('CODE', …)` with a bare string.
    if (
      ts.isNewExpression(node) &&
      node.expression.getText() === 'FeatureError' &&
      node.arguments?.length
    ) {
      const code = codeFromExpression(node.arguments[0]);
      if (code) recordEmit(code, file);
    }
    // The shared `internalError()` helper hard-codes INTERNAL_ERROR.
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === 'internalError'
    ) {
      recordEmit('INTERNAL_ERROR', file);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
}

// -------------------------------------------------- 3. controller mappers (derived)

interface Mapping {
  file: string;
  line: number;
  code: string;
  status: string;
}

const statusOf = (expr: ts.Expression | undefined): string | null =>
  expr &&
  ts.isPropertyAccessExpression(expr) &&
  expr.expression.getText() === 'HttpStatus'
    ? expr.name.text
    : null;

/** The status a case body / if-branch resolves to. */
const statusInBody = (nodes: ts.Node[]): string | null => {
  let found: string | null = null;
  // Prefer the authoritative position: `new HttpException(body, STATUS)` or
  // `res.status(STATUS)`. A structured body may repeat the status as a
  // `statusCode` field; taking the argument avoids depending on that.
  const preferred = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isNewExpression(node) &&
      node.expression.getText() === 'HttpException' &&
      (node.arguments?.length ?? 0) >= 2
    ) {
      const s = statusOf(node.arguments?.[1]);
      if (s) {
        found = s;
        return;
      }
    }
    if (
      ts.isCallExpression(node) &&
      /\.status$/.test(node.expression.getText()) &&
      node.arguments.length
    ) {
      const s = statusOf(node.arguments[0]);
      if (s) {
        found = s;
        return;
      }
    }
    ts.forEachChild(node, preferred);
  };
  nodes.forEach(preferred);
  if (found) return found;

  const anyStatus = (node: ts.Node): void => {
    if (found) return;
    const s = statusOf(node as ts.Expression);
    if (s) {
      found = s;
      return;
    }
    ts.forEachChild(node, anyStatus);
  };
  nodes.forEach(anyStatus);
  return found;
};

const controllerFiles = walk(
  API_SRC,
  (p) => p.endsWith('.controller.ts') && !isTestFile(p)
);
const mapperFiles = [
  ...controllerFiles,
  join(API_SRC, 'v1/shared/map-error.ts'), // the one shared helper, used by v1
  // Webhook orchestration lives BESIDE its controller, not inside it (Gate 5: a
  // handler body may only call the use case and return it). These modules ARE
  // the router for their route, so the code→status decisions in them are part
  // of the HTTP surface exactly as a controller's would be.
  join(API_SRC, 'webhooks/webhook-http-error.ts'),
  join(API_SRC, 'billing/stripe-billing-webhook-dispatch.ts'),
];

const mappings: Mapping[] = [];

for (const file of mapperFiles) {
  const sf = parse(file);
  const at = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    // --- Style A: a pure status map. Every value is `HttpStatus.X`, which is
    // what distinguishes a mapper from any other object literal in the file.
    if (ts.isObjectLiteralExpression(node) && node.properties.length > 0) {
      const isStatusMap = node.properties.every(
        (p) => ts.isPropertyAssignment(p) && statusOf(p.initializer) !== null
      );
      if (isStatusMap) {
        for (const prop of node.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const status = statusOf(prop.initializer);
          if (!status) continue;
          let code: string | null = null;
          if (ts.isComputedPropertyName(prop.name)) {
            code = codeFromExpression(prop.name.expression);
          } else if (ts.isStringLiteral(prop.name)) {
            code = prop.name.text;
          } else if (ts.isIdentifier(prop.name)) {
            code = prop.name.text;
          }
          if (code) {
            mappings.push({ file: rel(file), line: at(prop), code, status });
          }
        }
      }
    }

    // --- Style B: `switch (error.code) { case …: }`, incl. fallthrough labels.
    if (
      ts.isSwitchStatement(node) &&
      /\bcode\b/.test(node.expression.getText())
    ) {
      let pending: { code: string; line: number }[] = [];
      for (const clause of node.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) {
          pending = [];
          continue;
        }
        const code = codeFromExpression(clause.expression);
        if (code) pending.push({ code, line: at(clause) });
        if (clause.statements.length === 0) continue; // fallthrough label
        const status = statusInBody([...clause.statements]);
        if (status) {
          for (const p of pending) {
            mappings.push({
              file: rel(file),
              line: p.line,
              code: p.code,
              status,
            });
          }
        }
        pending = [];
      }
    }

    // --- Style C: `if (result.error.code === CODE) throw new HttpException(…)`
    if (ts.isIfStatement(node)) {
      const codes: string[] = [];
      const collect = (expr: ts.Expression): void => {
        if (ts.isParenthesizedExpression(expr)) {
          collect(expr.expression);
          return;
        }
        if (!ts.isBinaryExpression(expr)) return;
        if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          collect(expr.left);
          collect(expr.right);
          return;
        }
        if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken)
          return;
        if (/\.code$/.test(expr.left.getText())) {
          const c = codeFromExpression(expr.right);
          if (c) codes.push(c);
        } else if (/\.code$/.test(expr.right.getText())) {
          const c = codeFromExpression(expr.left);
          if (c) codes.push(c);
        }
      };
      collect(node.expression);
      if (codes.length) {
        const status = statusInBody([node.thenStatement]);
        if (status) {
          for (const code of codes) {
            mappings.push({ file: rel(file), line: at(node), code, status });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Does this file actually DISPATCH on an error code (as opposed to merely
 * mentioning one — e.g. logging `error.code`)? Derived from the AST: a switch
 * on `*.code`, a `=== ` comparison against `*.code`, or an index into a lookup
 * table by `*.code`. Any such file must yield at least one parsed mapping, or
 * the parser has gone blind and every check below would pass vacuously.
 */
const dispatchesOnErrorCode = (sf: ts.SourceFile): boolean => {
  let found = false;
  const endsWithCode = (n: ts.Node) => /\.code$/.test(n.getText());
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isSwitchStatement(node) && endsWithCode(node.expression))
      found = true;
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      (endsWithCode(node.left) || endsWithCode(node.right))
    )
      found = true;
    else if (
      ts.isElementAccessExpression(node) &&
      endsWithCode(node.argumentExpression)
    )
      found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

const mappingsByCode = new Map<string, Mapping[]>();
for (const m of mappings) {
  if (!mappingsByCode.has(m.code)) mappingsByCode.set(m.code, []);
  mappingsByCode.get(m.code)?.push(m);
}

const show = (m: Mapping) => `${m.file}:${m.line}`;

// ------------------------------------------------------------------- the gate

describe('error code → HTTP status', () => {
  // (e) A parser that silently stops seeing mappers would make every other
  // assertion below pass vacuously. Both guards are derived, not counted by
  // hand: every controller whose source mentions `error.code` MUST yield at
  // least one parsed mapping, and the enums must have been found at all.
  describe('the gate can see the tree', () => {
    it('found the error-code enums', () => {
      expect(declaredCodes.size).toBeGreaterThan(0);
      expect(
        new Set([...declaredCodes.values()].flatMap((s) => [...s])).size
      ).toBeGreaterThan(1);
    });

    it('parsed a mapping out of every controller that dispatches on error.code', () => {
      const mapped = new Set(mappings.map((m) => m.file));
      const dispatchers = mapperFiles.filter((f) =>
        dispatchesOnErrorCode(parse(f))
      );
      const blind = dispatchers.filter((f) => !mapped.has(rel(f))).map(rel);

      expect(dispatchers.length).toBeGreaterThan(0);
      expect({ blindTo: blind }).toEqual({ blindTo: [] });
    });
  });

  // (d) A mapper key that matches no declared code is already broken: it can
  // never fire. This is the check that makes bare-string cases safe to keep.
  it('(d) every mapper key is a real, declared error code', () => {
    const unknown = [...mappingsByCode.entries()]
      .filter(([code]) => !declaredCodes.has(code))
      .map(([code, ms]) => `${code} — mapped at ${ms.map(show).join(', ')}`);

    expect(unknown).toEqual([]);
  });

  // (a) THE ONE THAT MATTERS. Same code, same meaning, same status — whichever
  // route you happened to call.
  it('(a) maps each error code to exactly one HTTP status', () => {
    const conflicts = [...mappingsByCode.entries()]
      .map(([code, ms]) => {
        const byStatus = new Map<string, Mapping[]>();
        for (const m of ms) {
          if (!byStatus.has(m.status)) byStatus.set(m.status, []);
          byStatus.get(m.status)?.push(m);
        }
        return { code, byStatus };
      })
      .filter(({ byStatus }) => byStatus.size > 1)
      .map(
        ({ code, byStatus }) =>
          `${code} → ${[...byStatus.entries()]
            .map(([status, ms]) => `${status} (${ms.map(show).join(', ')})`)
            .join('  vs  ')}`
      );

    expect(conflicts).toEqual([]);
  });

  // (b) An emitted code no controller maps falls through `default` to a 500 —
  // a generic body, a stripped message and a Sentry page, for what is usually
  // an actionable 4xx.
  it('(b) maps every error code a service can emit', () => {
    const unmapped = [...emittedCodes.entries()]
      .filter(([code]) => !mappingsByCode.has(code))
      .filter(([code]) => !(code in NOT_HTTP_SURFACED))
      .map(
        ([code, files]) =>
          `${code} — emitted by ${[...files].join(', ')}, mapped by no controller (→ 500)`
      );

    expect(unmapped).toEqual([]);
  });

  // (c) A mapped code nothing emits is a dead case. Harmless on its own, but it
  // is the fossil of a renamed code — and proof that nothing was checking.
  it('(c) has no dead mappings for codes nothing emits', () => {
    const dead = [...mappingsByCode.entries()]
      .filter(([code]) => !emittedCodes.has(code))
      .map(
        ([code, ms]) =>
          `${code} — mapped at ${ms.map(show).join(', ')}, emitted by nothing`
      );

    expect(dead).toEqual([]);
  });

  // The escape hatch is itself ratcheted: it cannot rot, and it cannot be used
  // to silence a code that a controller now maps.
  it('keeps the NOT_HTTP_SURFACED allowlist honest', () => {
    const stale = Object.keys(NOT_HTTP_SURFACED).flatMap((code) => {
      if (mappingsByCode.has(code))
        return [`${code} — is now mapped by a controller; drop the exemption`];
      if (!emittedCodes.has(code))
        return [`${code} — is no longer emitted anywhere; drop the exemption`];
      return [];
    });

    expect(stale).toEqual([]);
    for (const reason of Object.values(NOT_HTTP_SURFACED)) {
      expect(reason.length).toBeGreaterThan(30); // a reason, not a shrug
    }
  });
});
