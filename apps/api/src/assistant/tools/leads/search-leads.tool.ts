import {
  type Lead,
  listLeadsResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const searchLeadsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Search term. Matches case-insensitively against first name, last ' +
        'name, email, and phone.'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(10)
    .describe('How many leads to return. Capped at 20.'),
});

interface SearchLeadsOutput {
  query: string;
  matches: Lead[];
  matchCount: number;
}

/**
 * `leads_searchLeads` — find leads by name / email / phone.
 *
 * Read-only. Backed by `GET /leads?search=...`. Tighter input shape than
 * `listLeads` so the classifier prefers it for "find me Aoife" / "lead with
 * phone +353…" asks. Notes are NOT searched (the underlying service indexes
 * name/email/phone only); flag this if it becomes a usability issue.
 */
export const searchLeadsTool = defineTool<
  z.infer<typeof searchLeadsInputSchema>,
  SearchLeadsOutput
>({
  feature: 'leads',
  action: 'searchLeads',
  description:
    "Search the organisation's leads by a free-text query. Matches against " +
    'first name, last name, email, and phone. Notes are not searched.',
  inputSchema: searchLeadsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Searching leads' },
  additionalAllowedPaths: [/^leads$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams({
      search: input.query,
      limit: String(input.limit),
    });
    const data = await ctx.apiFetch(`leads?${params.toString()}`, {
      schema: listLeadsResponseSchema,
    });
    return {
      data: {
        query: input.query,
        matches: data.items,
        matchCount: data.items.length,
      },
    };
  },
});
