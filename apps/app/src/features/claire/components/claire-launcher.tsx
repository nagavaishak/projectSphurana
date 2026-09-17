import { MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useClaireWidgetState } from '../lib/widget-state';

export function ClaireLauncher() {
  const isOpen = useClaireWidgetState((s) => s.isOpen);
  const isTourRunning = useClaireWidgetState((s) => s.isTourRunning);
  const toggleOpen = useClaireWidgetState((s) => s.toggleOpen);

  if (isTourRunning) return null;

  return (
    <Button
      type="button"
      aria-label={isOpen ? 'Close Claire' : 'Open Claire'}
      aria-expanded={isOpen}
      onClick={toggleOpen}
      className="fixed bottom-6 right-6 z-50 size-14 rounded-full p-0 shadow-lg"
    >
      <MessageCircle className="size-6" />
    </Button>
  );
}
