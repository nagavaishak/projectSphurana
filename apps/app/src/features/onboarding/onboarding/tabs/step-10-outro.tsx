import { FieldGroup } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  outroStyleLabels,
  outroStyleValues,
} from '@borradh-workspace/api-client/types';
import { Check } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step10OutroProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

/** Visual preview for "Offer" outro style */
function OfferPreview({ primaryColor }: { primaryColor: string }) {
  return (
    <div
      className="flex h-32 flex-col items-center justify-center gap-1 rounded"
      style={{ backgroundColor: '#939D93' }}
    >
      <div className="h-6 w-12 rounded bg-white/40" />
      <div className="text-[9px] text-white/70">Your Service Name</div>
      <div className="relative">
        <span className="text-base font-bold text-white">Now Just £450!</span>
        <div
          className="absolute bottom-0 left-0 h-1 w-full"
          style={{ backgroundColor: primaryColor }}
        />
      </div>
      <div className="text-[9px] text-white/60">(was £1350)</div>
    </div>
  );
}

/** Visual preview for "Location" outro style */
function LocationPreview({ primaryColor }: { primaryColor: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 rounded bg-[#FBFBFB]">
      <div className="text-[8px] font-bold tracking-widest text-[#090A07]">
        LIMITED TIME OFFER!
      </div>
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="h-8 w-8 rounded bg-white/40" />
      </div>
      <div className="text-[8px] font-semibold tracking-wider text-[#090A07]">
        33 Brent St, London
      </div>
    </div>
  );
}

/** Visual preview for "Tagline" outro style */
function TaglinePreview({ primaryColor }: { primaryColor: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-3 rounded bg-[#FDFDFD]">
      <div className="h-12 w-12 rounded bg-muted" />
      <div className="text-xs font-medium" style={{ color: primaryColor }}>
        Optimize Beauty in You
      </div>
    </div>
  );
}

/** Descriptions for each outro style */
const outroDescriptions: Record<string, string> = {
  offer: 'Highlight special offers and pricing with your brand color',
  location: 'Show your location with a call to action',
  tagline: 'Simple and clean with your logo and tagline',
};

/** Preview components for each style */
const previewComponents: Record<
  string,
  (props: { primaryColor: string }) => React.ReactElement
> = {
  offer: OfferPreview,
  location: LocationPreview,
  tagline: TaglinePreview,
};

/**
 * Step 10: Outro
 * Choose the outro style for generated videos with visual previews.
 */
export function Step10Outro({ form }: Step10OutroProps) {
  const primaryColor = form.watch('primaryColor') || '#7c3aed';

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Choose your outro style</h1>
        <p className="text-muted-foreground">
          This appears at the end of your generated videos
        </p>
      </div>

      <Controller
        name="outroStyle"
        control={form.control}
        render={({ field }) => (
          <div className="grid gap-4 sm:grid-cols-3">
            {outroStyleValues.map((value) => {
              const isSelected = field.value === value;
              const Preview = previewComponents[value];

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => field.onChange(value)}
                  className={cn(
                    'relative flex flex-col gap-2 rounded-lg border-2 p-3 text-left transition-all hover:border-primary/50',
                    isSelected ? 'border-primary bg-primary/5' : 'border-border'
                  )}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}

                  {/* Visual Preview */}
                  <div className="overflow-hidden rounded border">
                    {Preview && <Preview primaryColor={primaryColor} />}
                  </div>

                  {/* Label & Description */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {outroStyleLabels[value]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {outroDescriptions[value]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      />
    </FieldGroup>
  );
}
