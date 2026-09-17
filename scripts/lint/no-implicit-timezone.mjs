#!/usr/bin/env node

/**
 * Reject Date.toLocale* calls without an explicit timeZone in server code.
 * The script is intentionally small and has no external runtime dependency
 * beyond the repository's existing TypeScript installation.
 */

import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const METHODS = new Set([
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
]);
const NON_DATE_TYPES = new Set([
  'Number',
  'BigInt',
  'Array',
  'ReadonlyArray',
  'String',
  'Object',
]);
const IGNORE_RE = /timezone-lint-ignore:\s*\S+/;

const cwd = process.cwd();
const tsconfigPath = resolve(cwd, process.argv[2] ?? 'tsconfig.lib.json');
const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

if (configFile.error) {
  console.error(
    `[no-implicit-timezone] cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
  );
  process.exit(2);
}

const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  noEmit: true,
});
const checker = program.getTypeChecker();
const srcRoot = resolve(cwd, 'src') + sep;
const violations = [];

function ownersFor(propertyAccess) {
  const symbol = checker.getSymbolAtLocation(propertyAccess);
  const declarations = symbol?.declarations;
  if (!declarations?.length) return null;
  const names = new Set();
  for (const declaration of declarations) {
    const parent = declaration.parent;
    if (
      (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent)) &&
      parent.name
    ) {
      names.add(parent.name.text);
    }
  }
  return names.size ? names : null;
}

function hasTimeZone(call) {
  return call.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some((property) => {
        const name = property.name;
        return (
          name &&
          ((ts.isIdentifier(name) && name.text === 'timeZone') ||
            (ts.isStringLiteral(name) && name.text === 'timeZone'))
        );
      }),
  );
}

function hasIgnoreComment(sourceFile, line) {
  const lines = sourceFile.text.split('\n');
  return IGNORE_RE.test(lines[line] ?? '') || IGNORE_RE.test(lines[line - 1] ?? '');
}

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  const file = resolve(sourceFile.fileName);
  if (!file.startsWith(srcRoot)) continue;
  if (/\.(test|spec|int-spec)\.tsx?$/.test(file)) continue;
  if (file.includes(`${sep}__tests__${sep}`)) continue;

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      METHODS.has(node.expression.name.text)
    ) {
      const owners = ownersFor(node.expression);
      const isKnownNonDate =
        owners !== null && [...owners].every((name) => NON_DATE_TYPES.has(name));
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      if (!isKnownNonDate && !hasTimeZone(node) && !hasIgnoreComment(sourceFile, line)) {
        violations.push({
          file: relative(resolve(cwd, '../..'), file),
          line: line + 1,
          column: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (violations.length > 0) {
  console.error(
    `[no-implicit-timezone] ${violations.length} Date toLocale* call(s) need an explicit timeZone:`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}:${violation.column}`);
  }
  process.exit(1);
}

console.log('[no-implicit-timezone] ok');
