import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The registration gotcha, made mechanical.
 *
 * Claire lost a tool to this once: registered in the controller, forgotten in
 * `run-headless-turn.ts`, and the evals silently stopped exercising what
 * production ran. That is worse than either being broken, because it is
 * invisible.
 *
 * The structural fix is that there is ONE list (`MICROSITE_AGENT_TOOLS` in the
 * features package) and ONE adapter (`buildMicrositeToolDefinitions`), and
 * both entry points call the adapter. This spec guards that.
 *
 * It reads SOURCE rather than importing the tools: importing the features
 * barrel pulls the database schema graph, whose ESM-only cuid2 dependency
 * jest cannot load. The behavioural half — that each tool validates, refuses
 * and mutates correctly — lives in the features vitest suite, which can.
 */

const API_SRC = join(process.cwd(), 'src');
const FEATURES_AGENT = join(
  process.cwd(),
  '../../packages/features/src/microsites/agent'
);

const read = (path: string): string => readFileSync(path, 'utf8');

/** Contract §2, in the order it lists them. */
const CONTRACT_TOOLS = [
  'list_pages',
  'read_page',
  'add_block',
  'update_block',
  'move_block',
  'delete_block',
  'create_page',
  'delete_page',
  'update_theme',
  'update_seo',
  'search_org_assets',
  'generate_image',
  'preview',
];

describe('microsite tool registration', () => {
  const toolSources = [
    'read-tools.ts',
    'block-tools.ts',
    'page-tools.ts',
    'theme-tools.ts',
    'asset-tools.ts',
  ]
    .map((file) => read(join(FEATURES_AGENT, 'tools', file)))
    .join('\n');

  const registry = read(join(FEATURES_AGENT, 'tools/index.ts'));

  it('defines every contract §2 tool', () => {
    for (const name of CONTRACT_TOOLS) {
      expect(toolSources).toContain(`name: '${name}'`);
    }
  });

  it('puts every tool in the single registry', () => {
    const start = registry.indexOf('MICROSITE_AGENT_TOOLS: readonly');
    const array = registry.slice(
      registry.indexOf('[', start) + 1,
      registry.indexOf('];', start)
    );
    const listed = array
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    expect(listed).toHaveLength(CONTRACT_TOOLS.length);
  });

  it('is registered by the streaming controller path', () => {
    expect(
      read(join(API_SRC, 'microsites/agent/run-microsite-chat-turn.ts'))
    ).toContain('buildMicrositeToolDefinitions(');
  });

  it('is registered by the headless/eval runner too', () => {
    // The half that has been forgotten before.
    expect(read(join(API_SRC, 'assistant/lib/run-headless-turn.ts'))).toContain(
      'buildMicrositeToolDefinitions('
    );
  });

  it('builds both entry points from the same adapter', () => {
    const adapter = read(
      join(API_SRC, 'microsites/agent/microsite-tool-definitions.ts')
    );
    // One source of tools; nothing hand-lists them a second time.
    expect(adapter).toContain('for (const tool of MICROSITE_AGENT_TOOLS)');
  });

  it('never puts tenant identifiers or a confirmation flag in a tool schema', () => {
    // The session is not model input, and the model cannot claim a
    // confirmation it did not get — both are absent from every input schema.
    const schemas = [
      ...toolSources.matchAll(/inputSchema: ([\s\S]*?)\n {2}mutating:/g),
    ].map((match) => match[1]);
    expect(schemas.length).toBe(CONTRACT_TOOLS.length);
    for (const schema of schemas) {
      expect(schema).not.toContain('micrositeId');
      expect(schema).not.toContain('organizationId');
      expect(schema).not.toContain('confirmed');
    }
  });
});
