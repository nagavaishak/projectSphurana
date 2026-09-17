import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface AiFieldWrapperProps {
  isGenerating: boolean;
  hasGenerated: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AiFieldWrapper({
  isGenerating,
  hasGenerated,
  children,
  className,
}: AiFieldWrapperProps) {
  const [showReveal, setShowReveal] = useState(false);
  const prevGeneratingRef = useRef(isGenerating);
  const hasShownRevealRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (prevGeneratingRef.current && !isGenerating && hasGenerated) {
      setShowReveal(true);
      hasShownRevealRef.current = true;
      timer = setTimeout(() => setShowReveal(false), 3000);
    }

    if (
      !prevGeneratingRef.current &&
      !isGenerating &&
      hasGenerated &&
      !hasShownRevealRef.current
    ) {
      hasShownRevealRef.current = true;
      setShowReveal(true);
      timer = setTimeout(() => setShowReveal(false), 3000);
    }

    prevGeneratingRef.current = isGenerating;

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isGenerating, hasGenerated]);

  return (
    <div
      className={cn(
        'relative',
        showReveal && !isGenerating && 'ai-reveal-border',
        className
      )}
    >
      {isGenerating ? (
        <div className="ai-generating-field absolute inset-0 z-10 flex items-center justify-center rounded-md">
          <span className="text-sm text-muted-foreground">Generating...</span>
        </div>
      ) : null}
      <div className={cn(isGenerating && 'invisible')}>{children}</div>
    </div>
  );
}
