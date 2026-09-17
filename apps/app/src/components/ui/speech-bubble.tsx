import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

type SpeechBubblePosition = 'above' | 'right';

interface SpeechBubbleProps {
  text: string;
  position?: SpeechBubblePosition;
  typing?: boolean;
  onTypingComplete?: () => void;
  className?: string;
}

const TYPING_SPEED_MS = 25;

function SpeechBubble({
  text,
  position = 'above',
  typing = false,
  onTypingComplete,
  className,
}: SpeechBubbleProps) {
  const [displayedText, setDisplayedText] = useState(typing ? '' : text);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!typing) {
      setDisplayedText(text);
      return;
    }

    setDisplayedText('');
    indexRef.current = 0;

    intervalRef.current = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        if (intervalRef.current !== null) clearInterval(intervalRef.current);
        setDisplayedText(text);
        onTypingComplete?.();
      } else {
        setDisplayedText(text.slice(0, indexRef.current));
      }
    }, TYPING_SPEED_MS);

    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [text, typing, onTypingComplete]);

  return (
    <div
      className={cn(
        'relative rounded-2xl bg-card px-5 py-3.5 text-card-foreground shadow-md',
        'border border-border',
        className
      )}
    >
      <p className="text-sm leading-relaxed sm:text-base">
        {displayedText}
        {typing && displayedText.length < text.length && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
        )}
      </p>

      {/* Tail */}
      {position === 'above' && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
          <div className="h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-card drop-shadow-sm" />
        </div>
      )}
      {position === 'right' && (
        <div className="absolute top-1/2 -left-2 -translate-y-1/2">
          <div className="h-0 w-0 border-y-8 border-r-8 border-y-transparent border-r-card drop-shadow-sm" />
        </div>
      )}
    </div>
  );
}

export { SpeechBubble };
export type { SpeechBubbleProps, SpeechBubblePosition };
