import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { StockClipPicker } from '@/features/socials/components/stock-clip-picker';
import { getTemplateById } from '@borradh-workspace/features/videos/templates';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import {
  ChevronDownIcon,
  MusicIcon,
  SparklesIcon,
  UploadIcon,
  Volume2Icon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import {
  type VideoFormData,
  outroStyleOptions,
  videoCustomiseForm,
} from '../../-schema';
import { CaptionSettings } from '../caption-settings';
import { MusicSelectionDialog } from '../dialogs';

interface CustomiseStepProps {
  form: UseFormReturn<VideoFormData>;
}

/** Labels come from the form declaration — see `-schema`. */
const L = videoCustomiseForm.labels;

export function CustomiseStep({ form }: CustomiseStepProps) {
  const { register, watch, setValue } = form;
  const { templateId } = useVideoCreation();
  const { cdnUrl } = useRuntimeConfig();

  const cdnBaseUrl = cdnUrl ?? '';

  const templateMusicTracks = useMemo(
    () =>
      (getTemplateById(templateId)?.musicTracks ?? []).map((track) => ({
        ...track,
        url: `${cdnBaseUrl}${track.path}`,
      })),
    [templateId, cdnBaseUrl]
  );

  const [musicDialogOpen, setMusicDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const musicTrackId = watch('musicTrackId');
  const musicUrl = watch('musicUrl');
  const musicVolume = watch('musicVolume') ?? 0.05;
  const outroStyle = watch('outroStyle');
  const serviceId = watch('serviceId') || null;
  const allowStockFootage = watch('allowStockFootage') ?? false;
  const stockClipIds = watch('stockClipIds') ?? [];

  // Get selected music track name
  const selectedMusicName = musicTrackId
    ? musicTrackId === 'uploaded'
      ? 'Custom Audio'
      : templateMusicTracks.find((t) => t.id === musicTrackId)?.name ||
        'Selected'
    : null;

  const handleMusicSelect = (trackId: string | null, url: string | null) => {
    setValue('musicTrackId', trackId || undefined);
    setValue('musicUrl', url || undefined);
  };

  return (
    <div
      className="flex flex-col gap-6"
      data-claire-target="create-video-customise-step"
    >
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">Music & Captions</h2>
      </div>

      {/* Video title — submitted as the video's `title`; the wizard falls back
          to an auto-generated "Video <date>" when it is left blank. */}
      <div className="space-y-2">
        <Label htmlFor="video-title">{L.title}</Label>
        <Input
          id="video-title"
          maxLength={100}
          placeholder="Auto-generated if left blank"
          {...register('title')}
        />
      </div>

      {/* Music Selection */}
      <div className="space-y-2">
        <Label>{L.musicTrackId}</Label>
        <div className="flex flex-col gap-2 md:flex-row">
          <button
            type="button"
            aria-label={L.musicTrackId}
            onClick={() => setMusicDialogOpen(true)}
            className="flex min-h-10 w-full flex-1 items-center gap-3 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 md:w-auto"
          >
            <MusicIcon className="size-4 text-muted-foreground" />
            {selectedMusicName ? (
              <span className="flex-1 truncate">{selectedMusicName}</span>
            ) : (
              <span className="flex-1 text-muted-foreground">Select music</span>
            )}
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setMusicDialogOpen(true)}
            className="w-full gap-2 md:w-auto"
          >
            <UploadIcon className="size-4" />
            Upload
          </Button>
        </div>
      </div>

      {/* Stock Footage */}
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="stock-footage-toggle" className="text-sm">
                Use curated stock footage
              </Label>
              {allowStockFootage && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <SparklesIcon className="size-3" />
                  On
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Off by default. If any slot is missing footage, we&apos;ll still
              auto-fill it with relevant licensed stock clips; turn this on to
              browse and hand-pick specific ones instead.
            </span>
          </div>
          <Switch
            id="stock-footage-toggle"
            checked={allowStockFootage}
            onCheckedChange={(checked) =>
              setValue('allowStockFootage', checked, { shouldValidate: true })
            }
          />
        </div>

        {allowStockFootage && (
          <div className="grid gap-2">
            <Label className="text-sm">Curated stock footage</Label>
            <StockClipPicker
              serviceId={serviceId}
              selectedIds={stockClipIds}
              onChange={(ids) =>
                setValue('stockClipIds', ids, { shouldValidate: true })
              }
            />
          </div>
        )}
      </div>

      {/* Advanced Customization */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between w-full py-2 text-left font-medium hover:underline"
          >
            Advanced Customization
            <ChevronDownIcon
              className={`size-5 transition-transform duration-200 ${
                advancedOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 space-y-6">
          <CaptionSettings form={form} />

          {/* Outro Style — the closing card layout. In the schema and in the
              submitted draftConfig (`outro.outroStyle`) all along; its picker
              was dropped from this step and is restored here. */}
          <div className="space-y-3">
            <Label>{L.outroStyle}</Label>
            <p className="text-sm text-muted-foreground">
              Appears at the end of your video
            </p>
            <RadioGroup
              aria-label={L.outroStyle}
              value={outroStyle}
              onValueChange={(value) =>
                setValue('outroStyle', value as VideoFormData['outroStyle'])
              }
              className="flex flex-col gap-3 md:flex-row md:gap-4"
            >
              {outroStyleOptions.map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`outro-${value}`} />
                  <Label
                    htmlFor={`outro-${value}`}
                    className="font-normal cursor-pointer"
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Music Volume */}
          {(musicTrackId || musicUrl) && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Volume2Icon className="size-4" />
                {L.musicVolume}
              </Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[musicVolume * 100]}
                  onValueChange={([value]) =>
                    setValue('musicVolume', value / 100, {
                      shouldValidate: true,
                    })
                  }
                  max={100}
                  min={0}
                  step={5}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground w-12 text-right">
                  {Math.round(musicVolume * 100)}%
                </span>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Music Selection Dialog */}
      <MusicSelectionDialog
        open={musicDialogOpen}
        onOpenChange={setMusicDialogOpen}
        selectedTrackId={musicTrackId || null}
        selectedUrl={musicUrl || null}
        onSelect={handleMusicSelect}
        tracks={templateMusicTracks}
      />
    </div>
  );
}
