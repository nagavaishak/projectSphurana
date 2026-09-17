import { cn } from '@/lib/utils';
import { Film, Repeat } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { useAdWizard } from '../../-context';
import type { AdWizardFormData } from '../../-schema';

const options = [
  {
    value: 'new' as const,
    label: 'Create New Ad',
    description: 'Select a video and customize your ad copy',
    icon: Film,
  },
  {
    value: 'existing_post' as const,
    label: 'Use Existing Post',
    description: "Boost a post you've already published",
    icon: Repeat,
  },
];

export function AdSourceStep() {
  const { setValue, watch } = useFormContext<AdWizardFormData>();
  const { setAdSource } = useAdWizard();
  const current = watch('adSource') || 'new';

  const handleSelect = (value: 'new' | 'existing_post') => {
    setValue('adSource', value);
    setAdSource(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          How do you want to create your ad?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a new ad from scratch or boost an existing social post.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = current === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={cn(
                'flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-all',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <p className="font-medium">{option.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
