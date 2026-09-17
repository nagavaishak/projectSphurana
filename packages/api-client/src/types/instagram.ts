export interface InstagramIntegration {
  id: string;
  instagramUserId: string | null;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
  isActive: boolean;
  chatbotEnabled: boolean;
  tokenStatus: 'valid' | 'needs_reconnect';
  connectedByName: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
}

export interface GetInstagramIntegrationResponse {
  integration: InstagramIntegration | null;
}
