import { cn } from '@/lib/utils';

interface StepDotsProps {
  totalSteps: number;
  currentStep: number;
  className?: string;
}

export function StepDots({
  totalSteps,
  currentStep,
  className,
}: StepDotsProps) {
  return (
    <div className={cn('flex gap-1.5', className)}>
      {Array.from({ length: totalSteps }, (_, idx) => (
        <div
          key={idx}
          className={cn(
            'size-2 rounded-full transition-colors',
            idx === currentStep
              ? 'bg-primary'
              : idx < currentStep
                ? 'bg-primary/50'
                : 'bg-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}
