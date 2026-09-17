import {
  type Lead,
  listLeadsResponseSchema,
} from '@borradh-workspace/contracts';
import { leadSourceValues, leadStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const listLeadsInputSchema = z.object({
  status: z.enum(leadStatusValues).optional().describe('Filter by lead status'),
  source: z.enum(leadSourceValues).optional().describe('Filter by lead source'),
  search: z
    .string()
    .optional()
    .describe(
      'Filter by name, email, or phone using a case-insensitive substring match'
    ),
  sequenceId: z
    .string()
    .optional()
    .describe('Filter to leads currently assigned to this sequence'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(20)
    .describe('Page size, capped at 50. Default 20.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Pagination offset. Use to fetch the next page.'),
});

interface ListLeadsOutput {
  leads: Lead[];
  /**
   * Number of leads in this page slice. NOT the absolute total — for that,
   * use `leads_getLeadStats`.
   */
  pageCount: number;
  limit: number;
  offset: number;
}

/**
 * `leads_listLeads` — list leads in the active organization with filters.
 *
 * Read-only. Backed by the existing `GET /leads` endpoint. The model uses
 * this for "show me my leads" / "leads from facebook" / "booked leads"
 * type asks. For absolute counts use `leads_getLeadStats`; for in-place
 * search use `leads_searchLeads` (this tool also accepts `search` but the
 * dedicated search tool has a tighter input shape the classifier picks up).
 */
export const listLeadsTool = defineTool<
  z.infer<typeof listLeadsInputSchema>,
  ListLeadsOutput
>({
  feature: 'leads',
  action: 'listLeads',
  description:
    'List leads in the active organization. Optional filters: status, ' +
    'source, search (substring match on name/email/phone), sequenceId, ' +
    'limit, offset. Returns the current page; the `pageCount` value is the ' +
    'size of THIS page, not an absolute total. Use `leads_getLeadStats` for ' +
    'absolute counts.',
  inputSchema: listLeadsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing leads' },
  additionalAllowedPaths: [/^leads$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.status) params.set('status', input.status);
    if (input.source) params.set('source', input.source);
    if (input.search) params.set('search', input.search);
    if (input.sequenceId) params.set('sequenceId', input.sequenceId);
    params.set('limit', String(input.limit));
    params.set('offset', String(input.offset));

    const data = await ctx.apiFetch(`leads?${params.toString()}`, {
      schema: listLeadsResponseSchema,
    });
    return {
      data: {
        leads: data.items,
        pageCount: data.items.length,
        limit: data.limit,
        offset: data.offset,
      },
    };
  },
});
