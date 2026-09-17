import { AdvisorCardShell } from '../field-advisor/advisor-card-shell';

interface TourChatboxProps {
  target: Element;
  title?: string;
  copy: string;
  /** Show a "Got it" button — used when the step advances on `manual`. */
  showAdvanceButton?: boolean;
  /** Show the exit X in the header. Default true. */
  canExit?: boolean;
  onExit: () => void;
  onAdvance: () => void;
}

/**
 * Thin tour-mode wrapper around `AdvisorCardShell`. The shell owns positioning
 * and rendering; the tour runner owns lifecycle (polling, advance, exit).
 *
 * Kept as a thin adapter so the existing tour-runner contract doesn't change.
 */
export function TourChatbox({
  target,
  title,
  copy,
  showAdvanceButton,
  canExit = true,
  onExit,
  onAdvance,
}: TourChatboxProps) {
  return (
    <AdvisorCardShell
      target={target}
      content={{ title: title ?? 'Claire tour step', body: copy }}
      canExit={canExit}
      onDismiss={onExit}
      showAdvanceButton={showAdvanceButton}
      onAdvance={onAdvance}
    />
  );
}
