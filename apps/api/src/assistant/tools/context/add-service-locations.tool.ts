import {
  addServiceLocationsResponseSchema,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const addServiceLocationsInputSchema = z.object({
  serviceId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe(
      'ID of the service to offer at more branches (from listServices).'
    ),
  locationIds: z
    .array(
      z
        .string()
        .min(1)
        .regex(/^[\w-]+$/, 'Invalid ID format')
    )
    .min(1)
    .describe(
      'IDs of the branches that should ALSO offer this service. Additive — ' +
        'branches already offering it are left alone, and nothing is ever ' +
        'removed. Get the ids from the organization context.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface AddServiceLocationsOutput {
  serviceId: string;
  locationIds: string[];
}

/**
 * `context_addServiceLocations` — offer an existing service at more branches.
 *
 * The counterpart of `PUT /organization-services/:id/locations`, which stays
 * unreachable to Claire and says why in this area's coverage file: it REPLACES
 * the whole set, and its empty body means "offered at every branch", so the
 * natural model reasoning for "stop offering this in Cork" publishes it
 * everywhere instead. This tool cannot express that mistake — it only adds, an
 * empty list is rejected, and a service already offered everywhere is left
 * exactly as it is.
 *
 * Confirmation-gated like every other catalogue write: which branches offer a
 * service decides what a customer can book, and it is public within minutes.
 */
export const addServiceLocationsTool = defineTool<
  z.infer<typeof addServiceLocationsInputSchema>,
  AddServiceLocationsOutput
>({
  feature: 'context',
  action: 'addServiceLocations',
  description:
    'Offer an existing service at additional branches. ' +
    'Additive: branches that already offer it are unaffected, and no branch is ' +
    'ever removed. To take a service off a branch, or to change what a branch ' +
    'charges, a person does that in the dashboard. ' +
    'Requires operator confirmation. ' +
    'Use `listServices` for the serviceId and the organization context for branch ids.',
  inputSchema: addServiceLocationsInputSchema,
  // Matches the endpoint's own `@RequireRole('admin')`. Which branch offers
  // what is a commercial decision, and a tool that claimed a looser policy than
  // the route would simply fail at the API with a 403 the model cannot explain.
  policy: 'admin',
  // A confirmation gate, not a deletion: `destructive` is what makes the
  // factory run `summarizeForConfirmation` first, and adding a branch is
  // public to customers the moment it lands.
  destructive: true,
  destructiveAction: 'add_service_locations',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Adding branches' },
  additionalAllowedPaths: [
    /^organization-services$/,
    /^organization-services\/[a-zA-Z0-9_-]+$/,
    /^organization-services\/[a-zA-Z0-9_-]+\/locations$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const service = await ctx.apiFetch(
      `organization-services/${input.serviceId}`,
      { schema: organizationServiceSchema }
    );

    return {
      title: `Offer "${service.name}" at ${input.locationIds.length} more branch${
        input.locationIds.length === 1 ? '' : 'es'
      }`,
      fields: [
        { label: 'Service', value: service.name },
        { label: 'Branches to add', value: input.locationIds.join(', ') },
        {
          label: 'Effect',
          value:
            'Customers can book this service at those branches at the catalogue price. ' +
            'Nothing is removed from the branches that already offer it.',
        },
      ],
      resourceId: input.serviceId,
      payload: {
        serviceId: input.serviceId,
        locationIds: input.locationIds,
      },
    };
  },
  execute: async (input, ctx) => {
    const result = await ctx.apiFetch(
      `organization-services/${input.serviceId}/locations`,
      {
        method: 'POST',
        body: { locationIds: input.locationIds },
        schema: addServiceLocationsResponseSchema,
      }
    );

    return { data: result };
  },
});
