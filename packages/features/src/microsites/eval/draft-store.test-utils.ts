/**
 * A STATEFUL draft the tools can actually edit.
 *
 * `agent/agent-mock-db.test-utils.ts` is a stub: it records that an update
 * happened and hands back a canned row. That is the right shape for a unit test
 * ("did the tool call update at all"), and the wrong one here — this eval's
 * entire assertion surface is "what does the document look like after six
 * edits", which a stub cannot answer. So this file keeps the same drizzle chain
 * shapes and makes them WRITE, against rows built from the SAME fixtures
 * (`agent/agent-fixtures.test-utils.ts`) the unit tests use. No third fixture
 * set: the pages, blocks, theme and session all come from there.
 *
 * The where-clause reader below walks drizzle's `queryChunks` to recover the
 * `eq(column, value)` pairs. It is the one fragile thing in this file, and it
 * fails LOUDLY (a write that matches no row returns `[]`, which every
 * draft-writer primitive turns into NOT_FOUND) rather than silently writing to
 * the wrong page.
 */

import { microsite, micrositePage } from '@borradh-workspace/database';
import type {
  Block,
  MicrositeSeo,
  MicrositeTheme,
} from '@borradh-workspace/web-shared';
import { THEME } from '../agent/agent-fixtures.test-utils.js';

export interface EvalPageRow {
  id: string;
  micrositeId: string;
  organizationId: string;
  path: string;
  title: string;
  seo: MicrositeSeo;
  blocks: Block[];
  order: number;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvalSiteRow {
  id: string;
  organizationId: string;
  slug: string;
  status: 'draft';
  theme: MicrositeTheme;
  publishedRevisionId: string | null;
  draftRevisionId: string | null;
}

/* -------------------------------------------------------------------------- */
/* where-clause reader                                                         */
/* -------------------------------------------------------------------------- */

interface EqPair {
  column: string;
  value: unknown;
}

const isColumnNode = (node: Record<string, unknown>): boolean =>
  typeof node.columnType === 'string' && typeof node.name === 'string';

const isParamNode = (node: Record<string, unknown>): boolean =>
  'value' in node && !Array.isArray(node.value) && !isColumnNode(node);

/** Flatten drizzle's nested `SQL.queryChunks` into leaf nodes, in order. */
const leaves = (node: unknown, out: Record<string, unknown>[] = []) => {
  if (!node || typeof node !== 'object') return out;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) leaves(chunk, out);
    return out;
  }
  out.push(node as Record<string, unknown>);
  return out;
};

/** Recover the `eq(column, value)` pairs from a drizzle where expression. */
export const readEqPairs = (condition: unknown): EqPair[] => {
  const pairs: EqPair[] = [];
  let column: string | null = null;
  for (const node of leaves(condition)) {
    if (isColumnNode(node)) {
      column = node.name as string;
      continue;
    }
    if (column && isParamNode(node)) {
      pairs.push({ column, value: node.value });
      column = null;
    }
  }
  return pairs;
};

const matches = (pairs: EqPair[], row: Record<string, unknown>): boolean =>
  pairs.every(({ column, value }) => {
    const key = COLUMN_TO_FIELD[column];
    // An unrecognised column is a wiring change, not a match — fail closed.
    if (!key) return false;
    return row[key] === value;
  });

/** Snake-cased DB column -> the row field the fixtures use. */
const COLUMN_TO_FIELD: Record<string, string> = {
  id: 'id',
  microsite_id: 'micrositeId',
  organization_id: 'organizationId',
  is_system: 'isSystem',
  path: 'path',
};

/* -------------------------------------------------------------------------- */
/* the store                                                                   */
/* -------------------------------------------------------------------------- */

const clone = <T>(value: T): T => structuredClone(value);

const thenable = <T>(returning: () => Promise<T>) => {
  const promise = Promise.resolve(undefined) as Promise<unknown> & {
    returning: () => Promise<T>;
  };
  promise.returning = returning;
  return promise;
};

export interface EvalDraftStore {
  /** Cast to `DbConnection` at the call site, exactly as the unit tests do. */
  db: unknown;
  site: EvalSiteRow;
  pages: EvalPageRow[];
}

export const createEvalDraftStore = (input: {
  pages: EvalPageRow[];
  site: EvalSiteRow;
}): EvalDraftStore => {
  const state = {
    site: clone(input.site),
    pages: input.pages.map(clone),
  };
  let created = 0;

  const findPage = (pairs: EqPair[]) =>
    state.pages.find((page) =>
      matches(pairs, page as unknown as Record<string, unknown>)
    );

  const updateChain = (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (condition: unknown) =>
        thenable(async () => {
          const pairs = readEqPairs(condition);
          if (table === micrositePage) {
            const page = findPage(pairs);
            if (!page) return [];
            Object.assign(page, clone(patch));
            return [{ id: page.id }];
          }
          if (table === microsite) {
            if (
              !matches(pairs, state.site as unknown as Record<string, unknown>)
            ) {
              return [];
            }
            Object.assign(state.site, clone(patch));
            return [{ id: state.site.id }];
          }
          return [];
        }),
    }),
  });

  const insertChain = (table: unknown) => ({
    values: (values: Record<string, unknown>) =>
      thenable(async () => {
        if (table !== micrositePage) return [];
        created += 1;
        const row: EvalPageRow = {
          id: `page-created-${created}`,
          micrositeId: values.micrositeId as string,
          organizationId: values.organizationId as string,
          path: values.path as string,
          title: values.title as string,
          seo: (values.seo ?? {}) as MicrositeSeo,
          blocks: clone((values.blocks ?? []) as Block[]),
          order: values.order as number,
          isSystem: Boolean(values.isSystem),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        state.pages.push(row);
        return [{ id: row.id }];
      }),
  });

  const deleteChain = (table: unknown) => ({
    where: (condition: unknown) =>
      thenable(async () => {
        if (table !== micrositePage) return [];
        const pairs = readEqPairs(condition);
        const page = findPage(pairs);
        if (!page) return [];
        state.pages = state.pages.filter(
          (candidate) => candidate.id !== page.id
        );
        return [{ id: page.id }];
      }),
  });

  const db = {
    query: {
      microsite: {
        findFirst: async () => clone(state.site),
        findMany: async () => [clone(state.site)],
      },
      micrositePage: {
        findFirst: async () => clone(state.pages[0]),
        findMany: async () =>
          [...state.pages]
            .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
            .map(clone),
      },
      micrositeRevision: {
        findFirst: async () => undefined,
        findMany: async () => [],
      },
      micrositeConversation: {
        findFirst: async () => undefined,
        findMany: async () => [],
      },
      micrositeMessage: {
        findFirst: async () => undefined,
        findMany: async () => [],
      },
    },
    update: updateChain,
    insert: insertChain,
    delete: deleteChain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    get site() {
      return state.site;
    },
    get pages() {
      return state.pages;
    },
  };
};

/** The site row every case starts from unless it overrides the theme. */
export const evalSiteRow = (input: {
  micrositeId: string;
  organizationId: string;
  theme?: MicrositeTheme;
}): EvalSiteRow => ({
  id: input.micrositeId,
  organizationId: input.organizationId,
  slug: 'acme-salon',
  status: 'draft',
  theme: (input.theme ?? THEME) as MicrositeTheme,
  publishedRevisionId: null,
  draftRevisionId: null,
});
