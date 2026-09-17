/**
 * Can this batch produce graphics?
 *
 * One rule, one place. It used to be written twice — once in
 * `request-monthly-batch` and again in `plan-monthly-content` — and both said
 * "a graphic needs an uploaded image on a selected service". Removing either
 * one changed nothing, because the other still zeroed the count, and the second
 * did it with a `logger.info`: no error, no `error_message`, the batch left in
 * `generating`, and a request for six graphics returning zero with nothing on
 * the row to explain it.
 *
 * The rule itself was also out of date. `resolve-slot-image` resolves a slot
 * through four tiers:
 *
 *   service-video-thumbnail -> service-image-asset -> stock-image -> ai-generated
 *
 * so a graphic can be produced with no upload at all. `allowStockFootage` is
 * the owner's consent to fall back, and it is already what the VIDEO path uses
 * — honouring it for one modality and not the other was an oversight rather
 * than a policy.
 *
 * Deliberately not "always true": an owner who has declined stock should get
 * neither stock footage nor stock stills nor generated imagery.
 */
export function canPlanGraphics(input: {
  /** At least one selected service has a render-ready uploaded image. */
  hasUploadedImage: boolean;
  /** The owner allowed stock/generated fallbacks for this batch. */
  allowStockFootage: boolean;
}): boolean {
  return input.hasUploadedImage || input.allowStockFootage;
}
