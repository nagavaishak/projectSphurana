/**
 * Organization Configuration for better-auth
 * Defines additional fields for organizations
 */
export const organizationSetup = {
  schema: {
    organization: {
      additionalFields: {
        name: { type: 'string', input: true, required: true },
        logoUrl: { type: 'string', input: true, required: false },
        businessType: { type: 'string', input: true, required: true },
        mainProduct: { type: 'string', input: true, required: true },
        city: { type: 'string', input: true, required: true },
        country: { type: 'string', input: true, required: true },
        minPrice: { type: 'number', input: true, required: true },
        maxPrice: { type: 'number', input: true, required: true },
        idealCustomerProfile: { type: 'string', input: true, required: true },
        previousSuccesses: { type: 'string', input: true, required: true },
      },
    },
  },
} as const;
