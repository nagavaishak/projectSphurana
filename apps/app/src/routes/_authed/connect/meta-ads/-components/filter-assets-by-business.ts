/**
 * Narrow Meta assets to the business the wizard has selected.
 *
 * Only assets discovered through the business endpoints
 * (/{businessId}/owned_pages, /owned_ad_accounts) carry a businessId. Assets
 * that reached us through the token-scoped /me/accounts and /me/adaccounts
 * have none, and an equality filter silently dropped every one of them: orgs
 * whose page came in via /me/accounts opened the picker, saw nothing, and
 * reconnected in a loop while the backend had the page stored the whole time.
 *
 * An asset with no businessId isn't evidence it belongs to some *other*
 * business — it's the absence of evidence either way. Keep it.
 */
export const filterAssetsByBusiness = <T extends { businessId?: string }>(
  assets: T[],
  activeBusinessId: string | undefined
): T[] => {
  if (!activeBusinessId) return assets;
  return assets.filter(
    (asset) => !asset.businessId || asset.businessId === activeBusinessId
  );
};
