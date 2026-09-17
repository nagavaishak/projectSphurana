/**
 * Response for check email
 */
export interface CheckEmailResponse {
  exists: boolean;
  hasPassword: boolean;
  providers: string[];
}
