import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CircleIcon, SquareIcon } from 'lucide-react';

export type ScrollSpeed = 20 | 30 | 40;

const SPEED_OPTIONS: { label: string; value: ScrollSpeed }[] = [
  { label: 'Slow', value: 20 },
  { label: 'Medium', value: 30 },
  { label: 'Fast', value: 40 },
];

interface RecordingControlsProps {
  isRecording: boolean;
  scrollSpeed: ScrollSpeed;
  elapsedSeconds: number;
  onRecord: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ScrollSpeed) => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function RecordingControls({
  isRecording,
  scrollSpeed,
  elapsedSeconds,
  onRecord,
  onStop,
  onSpeedChange,
}: RecordingControlsProps) {
  return (
    <>
      {isRecording && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 backdrop-blur-sm">
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-sm font-medium text-white">
            {formatTime(elapsedSeconds)}
          </span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center gap-4 bg-gradient-to-t from-black/80 to-transparent pb-8 pt-16">
        {!isRecording && (
          <div className="flex items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur-sm">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSpeedChange(opt.value)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  scrollSpeed === opt.value
                    ? 'bg-white text-black'
                    : 'text-white/70 hover:text-white'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-20 w-20 rounded-full border-4 border-white bg-transparent p-0 hover:bg-transparent"
          onClick={isRecording ? onStop : onRecord}
        >
          {isRecording ? (
            <SquareIcon className="h-8 w-8 fill-red-500 text-red-500" />
          ) : (
            <CircleIcon className="h-16 w-16 fill-red-500 text-red-500" />
          )}
        </Button>

        <p className="text-sm text-white/60">
          {isRecording ? 'Tap to stop' : 'Tap to start recording'}
        </p>
      </div>
    </>
  );
}
