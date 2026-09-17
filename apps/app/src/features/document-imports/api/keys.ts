/** Query keys for the document-imports cache namespace. */
export const documentImportKeys = {
  all: ['document-imports'] as const,
  list: () => ['document-imports', 'list'] as const,
};
