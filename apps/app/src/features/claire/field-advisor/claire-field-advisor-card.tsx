import { AdvisorCardShell, type AdvisorContent } from './advisor-card-shell';
import { useFindClaireTarget } from './use-find-claire-target';

export interface ClaireFieldAdvisorCardProps {
  /** `data-claire-target` value of the element to anchor to. */
  targetSelector: string;
  content: AdvisorContent;
  onDismiss: () => void;
}

/**
 * Field-advisor card: looks up `data-claire-target="${targetSelector}"` in the
 * DOM and anchors the advisor card next to it. Renders nothing until the
 * target is mounted.
 *
 * Used outside the driver.js tour to surface Claire's recommendations beside
 * specific form fields (e.g. service list on /ads/new).
 */
export function ClaireFieldAdvisorCard({
  targetSelector,
  content,
  onDismiss,
}: ClaireFieldAdvisorCardProps) {
  const target = useFindClaireTarget(targetSelector);
  if (!target) return null;

  return (
    <AdvisorCardShell
      target={target}
      content={{ ...content, activeMarker: targetSelector }}
      onDismiss={onDismiss}
    />
  );
}
