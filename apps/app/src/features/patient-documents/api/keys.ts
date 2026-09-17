/** Query keys for the patient-documents cache namespace. */
export const patientDocumentKeys = {
  all: ['patient-documents'] as const,
  /** The signed-in patient's own vault (portal). */
  portal: ['patient-documents', 'portal'] as const,
  /** A lead's vault as seen by staff. */
  lead: (leadId: string) => ['patient-documents', 'lead', leadId] as const,
};
