/** Unified CRM lifecycle stages */
export type CrmStage =
  | 'New'
  | 'Contacted'
  | 'Onboarded'
  | 'Trial'
  | 'Customer'
  | 'Churned'
  | 'Lost';

export interface CreateContactOptions {
  email: string;
  name: string;
  stage?: CrmStage;
  businessName?: string;
  businessType?: string;
  notes?: string;
}

export interface UpdateContactOptions {
  email: string;
  stage?: CrmStage;
  businessName?: string;
  businessType?: string;
  notes?: string;
}

export interface UpsertContactOptions {
  email: string;
  name?: string;
  stage?: CrmStage;
  businessName?: string;
  businessType?: string;
  notes?: string;
}
