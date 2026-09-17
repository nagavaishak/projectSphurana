import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { UseFormReturn } from 'react-hook-form';
import { type VideoFormData, videoCustomiseForm } from '../-schema';

/** Labels come from the form declaration — see `-schema`. */
const L = videoCustomiseForm.labels;

interface CaptionSettingsProps {
  form: UseFormReturn<VideoFormData>;
}

const FONT_OPTIONS = [
  { value: 'inter', label: 'Inter', family: 'Inter' },
  { value: 'montserrat', label: 'Montserrat', family: 'Montserrat' },
  { value: 'roboto', label: 'Roboto', family: 'Roboto' },
  { value: 'poppins', label: 'Poppins', family: 'Poppins' },
  {
    value: 'bebas-neue',
    label: 'Bebas Neue',
    family: "'Bebas Neue', sans-serif",
  },
  {
    value: 'playfair-display',
    label: 'Playfair Display',
    family: "'Playfair Display', serif",
  },
] as const;

const POSITION_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
] as const;

export function CaptionSettings({ form }: CaptionSettingsProps) {
  const { watch, setValue } = form;

  const captionsEnabled = watch('captionsEnabled');
  const fontFamily = watch('fontFamily');
  const textColor = watch('textColor');
  const backgroundColor = watch('backgroundColor');
  const position = watch('position');

  return (
    <div className="space-y-6">
      {/* Captions toggle */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Label htmlFor="captions-toggle" className="font-medium">
            {L.captionsEnabled}
          </Label>
          <p className="text-sm text-muted-foreground mt-0.5">
            Show text captions on your video
          </p>
        </div>
        <Switch
          id="captions-toggle"
          checked={captionsEnabled}
          onCheckedChange={(checked) => setValue('captionsEnabled', checked)}
        />
      </div>

      {captionsEnabled && (
        <>
          {/* Caption font */}
          <div className="space-y-2">
            <Label>{L.fontFamily}</Label>
            <Select
              value={fontFamily}
              onValueChange={(value) =>
                setValue('fontFamily', value as VideoFormData['fontFamily'])
              }
            >
              <SelectTrigger aria-label={L.fontFamily} className="w-full">
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: font.family }}>
                      {font.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Color pickers */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Text color */}
            <div className="space-y-2">
              <Label htmlFor="text-color">{L.textColor}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="text-color"
                  type="color"
                  value={textColor}
                  onChange={(e) => setValue('textColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                />
                <span className="text-sm text-muted-foreground uppercase">
                  {textColor}
                </span>
              </div>
            </div>

            {/* Background color */}
            <div className="space-y-2">
              <Label htmlFor="bg-color">{L.backgroundColor}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="bg-color"
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setValue('backgroundColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                />
                <span className="text-sm text-muted-foreground uppercase">
                  {backgroundColor}
                </span>
              </div>
            </div>
          </div>

          {/* Caption position */}
          <div className="space-y-3">
            <Label>{L.position}</Label>
            <RadioGroup
              aria-label={L.position}
              value={position}
              onValueChange={(value) =>
                setValue('position', value as VideoFormData['position'])
              }
              className="flex flex-col gap-3 md:flex-row md:flex-wrap md:gap-4"
            >
              {POSITION_OPTIONS.map((position) => (
                <div key={position.value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={position.value}
                    id={`position-${position.value}`}
                  />
                  <Label
                    htmlFor={`position-${position.value}`}
                    className="font-normal cursor-pointer"
                  >
                    {position.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview</Label>
            <div
              className="relative rounded-lg overflow-hidden bg-muted h-24 flex items-end justify-center p-4"
              style={{
                justifyContent: 'center',
                alignItems:
                  position === 'top'
                    ? 'flex-start'
                    : position === 'center'
                      ? 'center'
                      : 'flex-end',
                paddingTop: position === 'top' ? '1rem' : undefined,
                paddingBottom: position === 'bottom' ? '1rem' : undefined,
              }}
            >
              <span
                className="px-3 py-1.5 rounded text-sm font-medium"
                style={{
                  fontFamily:
                    FONT_OPTIONS.find((f) => f.value === fontFamily)?.family ||
                    'Inter',
                  color: textColor,
                  backgroundColor,
                }}
              >
                Sample caption text
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
