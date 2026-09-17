import { Check, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { useCandidates, useRegenerateAdCandidate } from '../api/index';
import { ShimmerCard, SlideShell } from '../components/index';
import type {
  OnboardingAdCandidate,
  OnboardingSession,
  OnboardingSlide,
} from '../types';

export interface AdPickerSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const GRID_SLOTS = 4;
const PICK_COUNT = 2;

/** First usable rendered output for a candidate (skips failed slides). */
const previewOutput = (candidate: OnboardingAdCandidate) =>
  candidate.outputs?.find((o) => o.status !== 'failed' && o.url) ?? null;

/**
 * Slide 8 — `ad_picker`. 2×2 grid of generated ad graphics; the owner picks
 * exactly two to run. Cards render as they finish (3s poll); each has a
 * Regenerate action that re-rolls it with a change request. The selection is
 * persisted to the session's `selectedGraphicIds` COLUMN via the answer
 * payload — `updateOnboardingSession` lifts `{ selectedGraphicIds }` out of
 * the `ad_picker` answer (the launch orchestrator reads the column).
 */
export function AdPickerSlide({ session, onAdvance }: AdPickerSlideProps) {
  const { adCandidates } = useCandidates();
  const [selected, setSelected] = useState<string[]>(
    () => session.selectedGraphicIds ?? []
  );

  // Regenerate dialog state — which candidate + the owner's change request.
  const [regenTarget, setRegenTarget] = useState<string | null>(null);
  const [regenPrompt, setRegenPrompt] = useState('');
  const { regenerateAd, isRegenerating } = useRegenerateAdCandidate({
    onSuccess: () => {
      setRegenTarget(null);
      setRegenPrompt('');
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      if (prev.length >= PICK_COUNT) return prev; // max 2
      return [...prev, id];
    });
  };

  const handleRegenerate = () => {
    if (!regenTarget || !regenPrompt.trim()) return;
    // The replacement is a fresh graphic row — drop the old id if selected.
    setSelected((prev) => prev.filter((id) => id !== regenTarget));
    regenerateAd({ graphicId: regenTarget, prompt: regenPrompt.trim() });
  };

  const handleSubmit = () => {
    if (selected.length !== PICK_COUNT) return;
    onAdvance('video_picker', { selectedGraphicIds: selected });
  };

  // Pad with shimmer slots while candidates are still being minted.
  const placeholders = Math.max(0, GRID_SLOTS - adCandidates.length);

  return (
    <SlideShell
      step={8}
      headline="Great — pick **2 of these ads** to run."
      description="I made a few options from your intro offer. Choose the two you like — you can regenerate any of them first."
      onSubmit={handleSubmit}
      submitDisabled={selected.length !== PICK_COUNT}
    >
      <div className="grid grid-cols-2 gap-4">
        {adCandidates.map((candidate) => {
          const output = previewOutput(candidate);
          const isReady = candidate.status === 'ready' && output;
          const isFailed = candidate.status === 'failed';
          const isSelected = selected.includes(candidate.id);

          if (!isReady && !isFailed) {
            return (
              <ShimmerCard
                key={candidate.id}
                label="generating…"
                className="aspect-square"
              />
            );
          }

          return (
            <div key={candidate.id} className="relative">
              <button
                type="button"
                onClick={() => (isReady ? toggle(candidate.id) : undefined)}
                aria-pressed={isSelected}
                disabled={isFailed}
                className={cn(
                  'border-input relative block w-full overflow-hidden rounded-lg border transition-all',
                  isSelected && 'ring-primary border-primary ring-2',
                  isFailed && 'cursor-not-allowed opacity-60'
                )}
              >
                {isReady ? (
                  <img
                    src={output.url}
                    alt="Ad option"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center px-4 text-center text-sm">
                    This one failed to render — regenerate it.
                  </div>
                )}
                {isSelected && (
                  <span className="bg-primary text-primary-foreground absolute bottom-2 left-2 flex size-6 items-center justify-center rounded-full">
                    <Check className="size-4" />
                  </span>
                )}
              </button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 h-7 gap-1.5 px-2 text-xs shadow-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setRegenTarget(candidate.id);
                  setRegenPrompt('');
                }}
              >
                <RefreshCw className="size-3" />
                Regenerate
              </Button>
            </div>
          );
        })}
        {Array.from({ length: placeholders }).map((_, i) => (
          <ShimmerCard
            key={`placeholder-${i}`}
            label="generating…"
            className="aspect-square"
          />
        ))}
      </div>

      <p className="text-muted-foreground mt-4 text-sm">
        {selected.length} of {PICK_COUNT} selected
      </p>

      <Dialog
        open={regenTarget !== null}
        onOpenChange={(open) => !open && setRegenTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this ad</DialogTitle>
            <DialogDescription>
              Tell me what to change and I'll make a new version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ad-regen-prompt">What should I change?</Label>
            <Textarea
              id="ad-regen-prompt"
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. brighter colours, lead with the price, bigger logo…"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRegenTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleRegenerate}
              disabled={!regenPrompt.trim() || isRegenerating}
            >
              {isRegenerating ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SlideShell>
  );
}
