import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@borradh-workspace/testing';
import { videoRenderPayloadSchema } from './definitions/video-render.job.js';
import { DLQ_NAMES, QUEUE_NAMES, jobQueues } from './queues.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * THE JOB GATE.
 *
 * Rule: a gate's input must be DERIVED from the artifact it checks. If you type
 * a list of queues here, you are writing the next bug — that is literally how
 * the metrics collector's `QUEUE_NAMES` ended up watching 7 of 18 queues.
 *
 * So this test does not trust the registry. It ENUMERATES every `new Queue(...)`
 * (producer) and `new Worker(...)` (consumer) in the tree, resolves the queue
 * name each one is constructed with, and cross-checks against the declarations:
 *
 *   1. every queue a producer writes to is DECLARED;
 *   2. every DECLARED queue has a worker — unless it carries an explicit
 *      `disabled: '<reason>'`, which a human reads in review;
 *   3. every queue a worker consumes is DECLARED (and is not `disabled`);
 *   4. no file constructs a queue with a name this gate cannot resolve, so a
 *      new queue cannot hide behind a dynamic string.
 *
 * It failed on `sequence-execution` when it was written: a producer with no
 * consumer anywhere. See the `disabled` reason on that declaration.
 */

const REPO_ROOT = resolve(HERE, '../../../..');

/** Source roots that can contain BullMQ producers/consumers. */
const SCAN_ROOTS = [
  'packages/features/src',
  'packages/integrations/src',
  'apps/api/src',
  'apps/video-worker/src',
];

/**
 * Files that construct a `Queue`/`Worker` from a DYNAMIC name on purpose —
 * generic plumbing that is driven BY the registry (or by a queue name passed in
 * by a caller), not a queue of its own. Every entry needs a reason; anything
 * else with an unresolvable name fails assertion 4.
 */
const DYNAMIC_QUEUE_NAME_FILES: Record<string, string> = {
  'packages/features/src/shared/queue/dead-letter.ts':
    'generic `<queue>-dlq` helper — the name is the caller’s queue + "-dlq".',
  'packages/features/src/jobs/job-queue.ts':
    'the registry’s own queue factory — the name comes from the declaration.',
  'apps/api/src/health/metrics-collector.service.ts':
    'polls every queue in MONITORED_QUEUE_NAMES (derived from the registry).',
  'apps/api/src/admin/bull-board.middleware.ts':
    'renders every queue in MONITORED_QUEUE_NAMES (derived from the registry).',
};

interface Usage {
  queueName: string;
  file: string;
}

const listFiles = (dir: string): string[] => {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__mocks__')
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Identifier → queue name, derived from `queues.ts` itself:
 *   `export const videoRenderQueue = defineQueue({ name: 'video-render', …})`
 * so `new Queue(videoRenderQueue.name)` resolves.
 */
const queueDefIdentifiers = (): Map<string, string> => {
  const src = readFileSync(join(HERE, 'queues.ts'), 'utf8');
  const map = new Map<string, string>();
  const re = /export const (\w+)\s*=\s*defineQueue\(\{\s*name:\s*'([^']+)'/g;
  for (const m of src.matchAll(re)) map.set(m[1], m[2]);
  return map;
};

const DEF_IDENTS = queueDefIdentifiers();

/** Comments contain the words "new Queue(" — including in THIS file's docs. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

/**
 * `const QUEUE_NAME = 'literal'` / `const QUEUE_NAME = someQueueDef.name`.
 *
 * Restricted to SCREAMING_SNAKE identifiers — the convention every queue-name
 * constant in the tree follows. A loose match would bind ordinary locals (a
 * `const name = 'claire.whatsappNudges'` in an unrelated scheduler) and invent
 * queues that do not exist.
 */
const constBindings = (source: string): Map<string, string> => {
  const src = stripComments(source);
  const map = new Map<string, string>();
  for (const m of src.matchAll(
    /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[\w<>[\]| ]+)?\s*=\s*'([^']+)'/g
  )) {
    map.set(m[1], m[2]);
  }
  for (const m of src.matchAll(
    /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*([A-Za-z_$][\w$]*)\.name\b/g
  )) {
    const resolved = DEF_IDENTS.get(m[2]);
    if (resolved) map.set(m[1], resolved);
  }
  return map;
};

const resolveArg = (
  raw: string,
  locals: Map<string, string>
): string | null => {
  const trimmed = raw.trim();
  const literal = /^'([^']+)'$/.exec(trimmed);
  if (literal) return literal[1];
  const dotName = /^([A-Za-z_$][\w$]*)\.name$/.exec(trimmed);
  if (dotName) return DEF_IDENTS.get(dotName[1]) ?? null;
  return locals.get(trimmed) ?? null;
};

interface ScanResult {
  producers: Usage[];
  workers: Usage[];
  unresolved: Usage[];
}

const scan = (): ScanResult => {
  const producers: Usage[] = [];
  const workers: Usage[] = [];
  const unresolved: Usage[] = [];

  const files = SCAN_ROOTS.flatMap((root) => listFiles(join(REPO_ROOT, root)));
  const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

  // Pass 1: every `const NAME = 'literal'` in the tree. Queue-name constants
  // live in `*.schema.ts` files and are imported by the producer/worker, so
  // resolution has to be cross-file.
  const globals = new Map<string, string>();
  for (const src of sources.values()) {
    for (const [k, v] of constBindings(src)) globals.set(k, v);
  }

  for (const file of files) {
    {
      const src = stripComments(sources.get(file) as string);
      if (!src.includes('new Queue') && !src.includes('new Worker')) continue;

      const rel = relative(REPO_ROOT, file);
      const locals = new Map([...globals, ...constBindings(src)]);

      const collect = (
        re: RegExp,
        sink: Usage[],
        kind: 'producer' | 'worker'
      ) => {
        for (const m of src.matchAll(re)) {
          const name = resolveArg(m[1], locals);
          if (name) {
            sink.push({ queueName: name, file: rel });
          } else if (!DYNAMIC_QUEUE_NAME_FILES[rel]) {
            unresolved.push({
              queueName: `${kind}: ${m[1].trim()}`,
              file: rel,
            });
          }
        }
      };

      collect(
        /new Queue(?:Events)?\s*(?:<[^>]*>)?\s*\(\s*([^,)\n]+)/g,
        producers,
        'producer'
      );
      collect(
        /new Worker\s*(?:<[^>]*>)?\s*\(\s*([^,)\n]+)/g,
        workers,
        'worker'
      );
    }
  }

  return { producers, workers, unresolved };
};

const { producers, workers, unresolved } = scan();

const uniq = (xs: string[]) => [...new Set(xs)].sort();
const isDlq = (name: string) => name.endsWith('-dlq');

const producedQueues = uniq(
  producers.map((p) => p.queueName).filter((n) => !isDlq(n))
);
const producedDlqs = uniq(
  producers.map((p) => p.queueName).filter((n) => isDlq(n))
);
const consumedQueues = uniq(workers.map((w) => w.queueName));

const declaredQueues = uniq([...QUEUE_NAMES]);
const declaredNeedingWorker = uniq(
  jobQueues.filter((q) => !q.disabled).map((q) => q.name)
);
const declaredDisabled = uniq(
  jobQueues.filter((q) => q.disabled).map((q) => q.name)
);

describe('job registry (derived gate)', () => {
  it('finds the queues by enumeration, not by trusting the registry', () => {
    // Sanity: if the scanner ever stops finding anything (a refactor to a
    // different BullMQ construction style, say), every assertion below would
    // vacuously pass. Fail loudly instead.
    expect(producers.length).toBeGreaterThan(10);
    expect(workers.length).toBeGreaterThan(5);
  });

  it('every queue a producer writes to is declared', () => {
    const undeclared = producedQueues.filter(
      (name) => !declaredQueues.includes(name)
    );
    expect(
      undeclared,
      `Queue(s) produced in code but not declared in jobs/queues.ts: ${undeclared.join(', ')}`
    ).toEqual([]);
  });

  it('every queue a worker consumes is declared, and is not disabled', () => {
    const undeclared = consumedQueues.filter(
      (name) => !declaredQueues.includes(name)
    );
    expect(
      undeclared,
      `Queue(s) consumed by a Worker but not declared: ${undeclared.join(', ')}`
    ).toEqual([]);

    const disabledButConsumed = consumedQueues.filter((name) =>
      declaredDisabled.includes(name)
    );
    expect(
      disabledButConsumed,
      `Queue(s) declared disabled but a Worker exists: ${disabledButConsumed.join(', ')} — delete the "disabled" reason.`
    ).toEqual([]);
  });

  it('every declared queue has a worker (or an explicit disabled reason)', () => {
    const orphans = declaredNeedingWorker.filter(
      (name) => !consumedQueues.includes(name)
    );
    expect(
      orphans,
      `Queue(s) with a producer and NO worker anywhere — jobs enqueued here would silently never run: ${orphans.join(', ')}. Register a Worker, or declare the queue disabled with a written reason.`
    ).toEqual([]);
  });

  it('every disabled queue states why', () => {
    for (const q of jobQueues.filter((x) => x.disabled)) {
      expect(q.disabled?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('every declared queue is actually used (no fossil declarations)', () => {
    const used = new Set([...producedQueues, ...consumedQueues]);
    const unused = declaredQueues.filter((name) => !used.has(name));
    expect(
      unused,
      `Queue(s) declared but neither produced nor consumed: ${unused.join(', ')}`
    ).toEqual([]);
  });

  it('every DLQ written to belongs to a queue declared deadLetter: true', () => {
    const undeclaredDlqs = producedDlqs.filter(
      (name) => !DLQ_NAMES.includes(name)
    );
    expect(
      undeclaredDlqs,
      `DLQ(s) produced in code whose source queue is not declared deadLetter: ${undeclaredDlqs.join(', ')}`
    ).toEqual([]);
  });

  it('no queue is constructed from a name the gate cannot resolve', () => {
    // A dynamic queue name would let a whole queue hide from this gate (and
    // from the metrics/Bull Board lists derived from the registry). The only
    // files allowed to do it are the generic ones, each with a reason.
    expect(
      unresolved.map((u) => `${u.file} (${u.queueName})`),
      'Unresolvable queue name(s). Use the queue declaration, or add the file to DYNAMIC_QUEUE_NAME_FILES with a reason.'
    ).toEqual([]);
  });

  it('the video-render payload cannot be enqueued without its replay fields', () => {
    // The runtime twin of the compile-time guarantee. `theme` and
    // `synthesisOverrides` are required-and-nullable, not optional, so the
    // retry path cannot quietly leave them out — which is exactly what it did.
    const complete = {
      videoId: 'v1',
      organizationId: 'org1',
      draftConfig: { orientation: 'portrait' },
      variationId: null,
      templateId: null,
      createdById: null,
      schemaVersion: 2 as const,
      templateDocId: null,
      skipCompile: false,
      theme: null,
      synthesisOverrides: null,
      whatsappDelivery: null,
    };
    expect(videoRenderPayloadSchema.safeParse(complete).success).toBe(true);

    for (const field of ['theme', 'synthesisOverrides'] as const) {
      const { [field]: _dropped, ...withoutField } = complete;
      const parsed = videoRenderPayloadSchema.safeParse(withoutField);
      expect(
        parsed.success,
        `dropping "${field}" from the video-render payload must NOT parse — that is the unthemed-retry bug`
      ).toBe(false);
    }
  });

  it('the observability lists are derived, not hand-written', () => {
    // The metrics collector and Bull Board import MONITORED_QUEUE_NAMES; if a
    // queue is declared it is watched, full stop.
    expect(QUEUE_NAMES.length).toBe(jobQueues.length);
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
    for (const q of jobQueues) {
      if (q.deadLetter) expect(DLQ_NAMES).toContain(`${q.name}-dlq`);
    }
  });
});
