import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `GET microsites/mine` must return the envelope the editor reads.
 *
 * The feature layer returns a FLAT workspace (`micrositeId`, `slug`, `theme`,
 * `pages`, …) because that is also the agent's view of the document. The
 * editor's wire contract (§4) is `{ microsite, document }`. Those two
 * disagreed silently: the endpoint answered 200 with a complete 5KB body, the
 * client read `data.microsite` as undefined, and the editor rendered "we could
 * not load your website" — an error that pointed at the server, on a request
 * the server got right.
 *
 * Nothing caught it because each side was internally consistent and no test
 * put them in the same room. This one does, statically: importing the
 * transport pulls the database and better-auth, so the assertion is over the
 * source and the client's own type declaration.
 */
const read = (relative: string): string =>
  readFileSync(path.resolve(__dirname, relative), 'utf-8');

const CLIENT_TYPES = '../../../app/src/features/website/api/types.ts';

/** Field names inside `interface <name> { … }`. */
const fieldsOf = (source: string, name: string): string[] => {
  const body = source
    .slice(source.indexOf(`interface ${name} {`))
    .split('}')[0];
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
};

describe('GET microsites/mine envelope', () => {
  const transport = read('./microsite-workspace.ts');

  it('returns the { microsite, document } envelope the editor expects', () => {
    const client = read(CLIENT_TYPES);
    expect(fieldsOf(client, 'MicrositeMineResponse')).toEqual([
      'document',
      'microsite',
    ]);
    expect(transport).toContain('    microsite: {');
    expect(transport).toContain('    document: {');
  });

  it('supplies every field of MicrositeSummary the editor declares', () => {
    const client = read(CLIENT_TYPES);
    const envelope = transport
      .slice(transport.indexOf('    microsite: {'))
      .split('    },')[0];

    for (const field of fieldsOf(client, 'MicrositeSummary')) {
      expect(envelope).toContain(`${field}:`);
    }
  });

  it('supplies the document as theme + pages', () => {
    const envelope = transport
      .slice(transport.indexOf('    document: {'))
      .split('\n')[0];
    expect(envelope).toContain('theme');
    expect(envelope).toContain('pages');
  });
});
