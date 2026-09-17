import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Static enumeration of the capability ports declared in
 * `packages/contracts/src/ports/*.port.ts`.
 *
 * The coverage manifest references port methods by `PortName.method`. Reading
 * the real interface bodies here is what makes those references load-bearing:
 * delete `VideosPort.export` and every endpoint claiming it as coverage
 * immediately reports an unknown port method, so Gate 1 fails in the same
 * commit Gate 2 does.
 *
 * Static parse, not a type-level trick, because the manifest must be able to
 * name a port method as a *string* — a compile-time reference would make the
 * api package depend on port shapes that do not exist yet.
 */

export interface PortSurface {
  /** `VideosPort.createDraft` for every method on every exported port. */
  methods: Set<string>;
  /** Port interface names found, e.g. `VideosPort`. */
  portNames: string[];
}

/** `export interface VideosPort {` — ports are always exported interfaces. */
const PORT_INTERFACE_RE = /^export interface ([A-Za-z_$][\w$]*Port)\s*\{/;

/**
 * A method member: `createDraft(req: X): Promise<Y>;` — the leading name up to
 * its parameter list, at one level of indentation inside the interface body.
 */
const METHOD_RE = /^ {2}([A-Za-z_$][\w$]*)\s*(?:\?)?\s*\(/;

export function collectPortMethods(portsDir: string): PortSurface {
  const methods = new Set<string>();
  const portNames: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(portsDir);
  } catch {
    return { methods, portNames };
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.port.ts')) continue;
    const lines = readFileSync(path.join(portsDir, entry), 'utf8').split('\n');

    let current: string | null = null;
    let depth = 0;

    for (const line of lines) {
      if (current === null) {
        const open = PORT_INTERFACE_RE.exec(line);
        if (open) {
          current = open[1];
          portNames.push(current);
          depth = 1;
        }
        continue;
      }

      // Track nesting so members of inline object types are not read as
      // methods of the port itself.
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;

      if (depth === 1) {
        const method = METHOD_RE.exec(line);
        if (method) methods.add(`${current}.${method[1]}`);
      }

      depth += opens - closes;
      if (depth <= 0) current = null;
    }
  }

  return { methods, portNames };
}
