import { organizationServiceSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const deleteServiceInputSchema = z.object({
  serviceId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe(
      'ID of the service to permanently delete (cuid2, from listServices).'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface DeleteServiceOutput {
  serviceId: string;
  deleted: boolean;
}

/**
 * `context_deleteService` — permanently delete a service from the organization.
 *
 * Prefer setting `isActive: false` via `updateService` for temporary
 * unavailability — that hides the service without removing linked history.
 * This tool performs a hard delete: the service record, any linked ad
 * associations, and offer associations are removed. Requires operator
 * confirmation and surfaces the service name + active status so the operator
 * knows exactly what will be removed.
 */
export const deleteServiceTool = defineTool<
  z.infer<typeof deleteServiceInputSchema>,
  DeleteServiceOutput
>({
  feature: 'context',
  action: 'deleteService',
  description:
    'Permanently delete a service from the organization. ' +
    'Consider using `updateService` with `isActive: false` first — that hides ' +
    'the service without removing its history. ' +
    'Deletion removes the service record and its links to ads and offers. ' +
    'Requires operator confirmation. ' +
    'Use `listServices` or `getServiceDetails` to find the serviceId first.',
  inputSchema: deleteServiceInputSchema,
  destructive: true,
  destructiveAction: 'delete_service',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Deleting service' },
  additionalAllowedPaths: [
    /^organization-services$/,
    /^organization-services\/[a-zA-Z0-9_-]+$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const service = await ctx.apiFetch(
      `organization-services/${input.serviceId}`,
      { schema: organizationServiceSchema }
    );

    return {
      title: `Delete service "${service.name}"`,
      fields: [
        { label: 'Service name', value: service.name },
        // `category` is a non-null enum column — the hand-written lookup type
        // this replaces declared it nullable, so the `?? 'Uncategorised'`
        // fallback here was unreachable.
        { label: 'Category', value: service.category },
        {
          label: 'Currently active',
          value: service.isActive
            ? 'Yes — customers can see this service'
            : 'No — already hidden',
        },
        {
          label: 'Warning',
          value:
            'This permanently removes the service and its links to ads and offers. ' +
            'Use updateService with isActive: false to hide it instead.',
        },
      ],
      resourceId: input.serviceId,
      payload: { serviceId: input.serviceId },
    };
  },
  execute: async (input, ctx) => {
    await ctx.apiFetch(`organization-services/${input.serviceId}`, {
      method: 'DELETE',
    });

    return {
      data: {
        serviceId: input.serviceId,
        deleted: true,
      },
    };
  },
});
