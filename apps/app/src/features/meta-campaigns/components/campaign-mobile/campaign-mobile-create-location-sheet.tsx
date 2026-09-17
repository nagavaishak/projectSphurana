import { CitySearch } from '@/components/app/city-search';
import { MobileBottomSheet } from '@/components/mobile-bottom-sheet/mobile-bottom-sheet';
import { createCampaignFormLabels as L } from '@/features/meta-campaigns/components/create-campaign-form';
import { cn } from '@/lib/utils';
import { MapPin, X } from 'lucide-react';

interface CampaignMobileCreateLocationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationName: string;
  distanceKm: number;
  onDistanceKmChange: (value: number) => void;
  onLocationSelect: (result: {
    name: string;
    latitude: number;
    longitude: number;
  }) => void;
  onClearLocation: () => void;
}

const MOBILE_INPUT_CLASS =
  'h-[44px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

export function CampaignMobileCreateLocationSheet({
  open,
  onOpenChange,
  locationName,
  distanceKm,
  onDistanceKmChange,
  onLocationSelect,
  onClearLocation,
}: CampaignMobileCreateLocationSheetProps) {
  const hasLocation = Boolean(locationName.trim());

  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Campaign location"
      keyboardAware
      className="z-[110]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-[#8E8E93]">Address</p>
          {hasLocation ? (
            <div className="flex h-[44px] items-center gap-2 rounded-lg border border-[#E5E5EA] bg-white px-3">
              <MapPin
                className="size-4 shrink-0 text-[#8E8E93]"
                strokeWidth={2}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[15px] text-black">
                {locationName}
              </span>
              <button
                type="button"
                onClick={onClearLocation}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#8E8E93] active:bg-[#F2F2F7]"
                aria-label="Clear location"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
          ) : (
            <CitySearch
              onCitySelect={(result) => {
                onLocationSelect(result);
              }}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-[#8E8E93]">
            {L.targetingDistanceKm}
          </p>
          <div className="relative">
            <input
              type="number"
              aria-label={L.targetingDistanceKm}
              min={1}
              max={500}
              step={1}
              value={distanceKm}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) onDistanceKmChange(v);
              }}
              className={cn(MOBILE_INPUT_CLASS, 'pr-12')}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] text-[#8E8E93]">
              km
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-2 h-[44px] w-full rounded-lg bg-[#2E65F3] text-[15px] font-medium text-white active:opacity-90"
        >
          Done
        </button>
      </div>
    </MobileBottomSheet>
  );
}
