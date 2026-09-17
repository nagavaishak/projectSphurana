/**
 * Saved payment methods (Stripe SetupIntent) for a client.
 *
 * STUB — the SetupIntent backend does NOT exist yet (no `/leads/:id/cards`
 * endpoint, no saved-card table). This hook intentionally makes no network
 * call and returns an empty, "coming soon" shape so the payment-methods UI is
 * already wired to a hook. When the backend lands, replace the body with a
 * real React Query call against the new endpoint and flip `isComingSoon` off —
 * the component contract (below) stays identical, so no UI change is required.
 */

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export const useClientSavedCards = (_leadId: string) => {
  return {
    cards: [] as SavedCard[],
    isLoading: false,
    isError: false,
    /** True until the SetupIntent backend exists (contract §7 / task scope). */
    isComingSoon: true,
  };
};
