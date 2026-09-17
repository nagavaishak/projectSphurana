import { Check } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { useCandidates } from '../api/index';
import { ShimmerCard, SlideShell } from '../components/index';
import type {
  OnboardingSession,
  OnboardingSlide,
  OnboardingVideoCandidate,
} from '../types';

export interface VideoPickerSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const GRID_SLOTS = 4;

/**
 * `previewUrl` is the signed blobUrl when the render is done, else the
 * thumbnail — try <video> first and fall back to an <img> if the browser
 * can't play the source (e.g. it's actually a thumbnail image).
 */
function VideoTile({ candidate }: { candidate: OnboardingVideoCandidate }) {
  const [videoFailed, setVideoFailed] = useState(false);

  if (!candidate.previewUrl || videoFailed) {
    return candidate.previewUrl ? (
      <img
        src={candidate.previewUrl}
        alt="Video option"
        className="aspect-square w-full object-cover"
      />
    ) : (
      <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center text-sm">
        Preview unavailable
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useMediaCaption: generated ad preview
    <video
      src={candidate.previewUrl}
      className="aspect-square w-full object-cover"
      controls
      playsInline
      preload="metadata"
      onError={() => setVideoFailed(true)}
    />
  );
}

/**
 * Slide 9 — `video_picker`. Same grid as the ad picker, but video candidates
 * and exactly ONE pick. The selection persists to the session's
 * `selectedVideoId` COLUMN via the answer payload (`updateOnboardingSession`
 * lifts `{ selectedVideoId }` out of the `video_picker` answer).
 */
export function VideoPickerSlide({
  session,
  onAdvance,
}: VideoPickerSlideProps) {
  const { videoCandidates } = useCandidates();
  const [selected, setSelected] = useState<string | null>(
    () => session.selectedVideoId
  );

  const handleSubmit = () => {
    if (!selected) return;
    onAdvance('campaign_review', { selectedVideoId: selected });
  };

  const placeholders = Math.max(0, GRID_SLOTS - videoCandidates.length);

  return (
    <SlideShell
      step={9}
      headline="Now pick a **video** to run."
      description="Videos take a little longer to render — they'll appear here as they finish. Pick the one you like best."
      onSubmit={handleSubmit}
      submitDisabled={!selected}
    >
      <div className="grid grid-cols-2 gap-4">
        {videoCandidates.map((candidate) => {
          const isReady = candidate.status === 'ready' && candidate.previewUrl;
          const isFailed = candidate.status === 'failed';
          const isSelected = selected === candidate.id;

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
            <div
              key={candidate.id}
              className={cn(
                'border-input relative overflow-hidden rounded-lg border transition-all',
                isSelected && 'ring-primary border-primary ring-2',
                isFailed && 'opacity-60'
              )}
            >
              {isReady ? (
                <VideoTile candidate={candidate} />
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center px-4 text-center text-sm">
                  This one failed to render.
                </div>
              )}
              {isReady && (
                <button
                  type="button"
                  onClick={() => setSelected(candidate.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'absolute top-2 left-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background/90 text-foreground hover:bg-background'
                  )}
                >
                  {isSelected && <Check className="size-3" />}
                  {isSelected ? 'Selected' : 'Pick this one'}
                </button>
              )}
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
    </SlideShell>
  );
}
