import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TemplateMusicTrack } from '@borradh-workspace/features/videos/templates';

/** TemplateMusicTrack with a resolved CDN url */
type ResolvedMusicTrack = TemplateMusicTrack & { url: string };

import {
  CheckIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../data/-music-tracks';

interface MusicSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTrackId: string | null;
  selectedUrl: string | null;
  onSelect: (trackId: string | null, url: string | null) => void;
  tracks: ResolvedMusicTrack[];
}

export function MusicSelectionDialog({
  open,
  onOpenChange,
  selectedTrackId,
  selectedUrl,
  onSelect,
  tracks,
}: MusicSelectionDialogProps) {
  const [localTrackId, setLocalTrackId] = useState<string | null>(
    selectedTrackId
  );
  const [localUrl, setLocalUrl] = useState<string | null>(selectedUrl);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [uploadedTrack, setUploadedTrack] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local state with prop when dialog opens
  useEffect(() => {
    if (open) {
      setLocalTrackId(selectedTrackId);
      setLocalUrl(selectedUrl);
    }
  }, [open, selectedTrackId, selectedUrl]);

  // Cleanup audio when dialog closes
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
      setPlayingId(null);
    }
  }, [open]);

  const handlePlayPause = (track: { id: string; url: string }) => {
    if (playingId === track.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
        audioRef.current = null;
      }
      const audio = new Audio(track.url);
      audioRef.current = audio;
      audio.addEventListener('ended', () => setPlayingId(null));
      audio.play().catch(() => {
        // Interrupted by pause or new track — safe to ignore
      });
      setPlayingId(track.id);
    }
  };

  const handleSelectLibraryTrack = (track: ResolvedMusicTrack) => {
    setLocalTrackId(track.id);
    setLocalUrl(track.url);
    setUploadedTrack(null);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, etc.)');
      return;
    }

    // Create object URL for preview
    const url = URL.createObjectURL(file);
    setUploadedTrack({ name: file.name, url });
    setLocalTrackId('uploaded');
    setLocalUrl(url);
  };

  const handleRemoveUploaded = () => {
    if (uploadedTrack) {
      URL.revokeObjectURL(uploadedTrack.url);
    }
    setUploadedTrack(null);
    if (localTrackId === 'uploaded') {
      setLocalTrackId(null);
      setLocalUrl(null);
    }
  };

  const handleConfirm = () => {
    onSelect(localTrackId, localUrl);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalTrackId(selectedTrackId);
    setLocalUrl(selectedUrl);
    onOpenChange(false);
  };

  const handleClearSelection = () => {
    setLocalTrackId(null);
    setLocalUrl(null);
    setUploadedTrack(null);
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Background Music</DialogTitle>
          <DialogDescription>
            Choose a track from our library or upload your own audio file.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="library" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="library" className="flex-1">
              <MusicIcon className="size-4 mr-2" />
              Library
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              <UploadIcon className="size-4 mr-2" />
              Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {tracks.map((track) => {
                const isSelected = localTrackId === track.id;
                const isPlaying = playingId === track.id;

                return (
                  <div
                    key={track.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectLibraryTrack(track)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectLibraryTrack(track);
                      }
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                    }`}
                  >
                    {/* Play/Pause button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayPause(track);
                      }}
                      className="flex-shrink-0 size-10 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
                    >
                      {isPlaying ? (
                        <PauseIcon className="size-4" />
                      ) : (
                        <PlayIcon className="size-4 ml-0.5" />
                      )}
                    </button>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{track.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {track.artist ? `${track.artist} \u2022 ` : ''}
                        {formatDuration(track.duration)}
                      </p>
                    </div>

                    {/* Selected indicator */}
                    {isSelected && (
                      <CheckIcon className="size-5 text-primary flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div className="space-y-4">
              {!uploadedTrack ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                >
                  <UploadIcon className="size-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium">Click to upload audio</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    MP3, WAV, or other audio formats
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              ) : (
                <div
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    localTrackId === 'uploaded'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  }`}
                >
                  {/* Play/Pause button */}
                  <button
                    type="button"
                    onClick={() =>
                      handlePlayPause({
                        id: 'uploaded',
                        url: uploadedTrack.url,
                      })
                    }
                    className="flex-shrink-0 size-10 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
                  >
                    {playingId === 'uploaded' ? (
                      <PauseIcon className="size-4" />
                    ) : (
                      <PlayIcon className="size-4 ml-0.5" />
                    )}
                  </button>

                  {/* Track info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{uploadedTrack.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Uploaded audio
                    </p>
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={handleRemoveUploaded}
                    className="flex-shrink-0 size-8 rounded-full flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <XIcon className="size-4" />
                  </button>

                  {/* Selected indicator */}
                  {localTrackId === 'uploaded' && (
                    <CheckIcon className="size-5 text-primary flex-shrink-0" />
                  )}
                </div>
              )}

              {uploadedTrack && localTrackId !== 'uploaded' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setLocalTrackId('uploaded');
                    setLocalUrl(uploadedTrack.url);
                  }}
                >
                  Use uploaded audio
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {(localTrackId || localUrl) && (
            <Button
              variant="ghost"
              onClick={handleClearSelection}
              className="sm:mr-auto"
            >
              No music
            </Button>
          )}
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            {localTrackId ? 'Confirm Selection' : 'Continue without music'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
