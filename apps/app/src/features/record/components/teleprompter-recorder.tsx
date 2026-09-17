import { Button } from '@/components/ui/button';
import { useCompleteMobileUpload, useUploadVideo } from '@/features/upload';
import { useGetVideo, useUpdateVideo } from '@/features/videos';
import { logError } from '@/lib/log-error';
import { ROUTES } from '@/lib/route-paths';
import { useSession } from '@/lib/session';
import { useResolvedRoutes } from '@/lib/use-routes';
import { isApiClientError } from '@borradh-workspace/api-client';
import { Capacitor } from '@capacitor/core';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  CameraOffIcon,
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
  RotateCcwIcon,
  ScrollTextIcon,
  VideoOffIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  putRecordingToS3,
  verifyMobileUploadToken,
} from '../api/mobile-token-upload';
import { RecordingControls, type ScrollSpeed } from './recording-controls';
import {
  TeleprompterOverlay,
  type TeleprompterOverlayHandle,
} from './teleprompter-overlay';

type RecordingState =
  | 'idle'
  | 'countdown'
  | 'recording'
  | 'review'
  | 'uploading'
  | 'done';

function getSupportedMimeType(): string {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'webm';
}

interface TeleprompterRecorderProps {
  videoId: string;
  /**
   * Scoped upload token (minted by the authed desktop, carried in the QR).
   * Used ONLY as a fallback when the viewer has no session: it resolves the
   * script + upload target from the public `mobile-verify` endpoint and uploads
   * via the token flow. A signed-in viewer ignores it and uses the authed flow.
   */
  uploadToken?: string;
}

export function TeleprompterRecorder({
  videoId,
  uploadToken,
}: TeleprompterRecorderProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  // Prefer the normal authed flow when the viewer has a session. The scoped
  // upload token is only a fallback for a signed-out phone (magic link scanned
  // on a device that isn't logged in) — signed-in users record and upload
  // through their own session exactly like "Record on this device".
  const { data: sessionData, isPending: isSessionPending } = useSession();
  const isTokenMode = !!uploadToken && !sessionData?.user;

  const [state, setState] = useState<RecordingState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [scrollSpeed, setScrollSpeed] = useState<ScrollSpeed>(30);
  const [permissionState, setPermissionState] = useState<
    'pending' | 'granted' | 'denied'
  >('pending');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const recordedFileRef = useRef<File | null>(null);

  const videoElRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const teleprompterRef = useRef<TeleprompterOverlayHandle>(null);

  // Token mode resolves the script (and later the upload URL) from the public
  // `mobile-verify` endpoint, so we never hit the authed video fetch.
  const [tokenScript, setTokenScript] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<'loading' | 'ready' | 'invalid'>(
    isTokenMode ? 'loading' : 'ready'
  );

  useEffect(() => {
    // Only the signed-out fallback resolves the script via the token; signed-in
    // viewers get it from the authed video fetch below.
    if (!isTokenMode || !uploadToken) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await verifyMobileUploadToken(uploadToken);
        if (cancelled) return;
        setTokenScript(result.scriptText ?? '');
        setTokenState('ready');
      } catch (error) {
        if (cancelled) return;
        logError('record.verifyToken', error, { feature: 'record' });
        setTokenState('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTokenMode, uploadToken]);

  const {
    video,
    isLoading: isVideoLoading,
    error: videoError,
  } = useGetVideo(videoId, {
    enabled: !isTokenMode,
    refetchInterval: !isTokenMode && state === 'idle' ? 1500 : false,
  });

  // The web wizard deletes the draft when it's closed. A 404 here means the
  // recording session is over and there's nothing left to record into. In
  // token mode, an invalid/expired token is the equivalent signal.
  const videoGone = isTokenMode
    ? tokenState === 'invalid'
    : isApiClientError(videoError) && videoError.status === 404;

  const { updateVideoAsync } = useUpdateVideo({ silent: true });

  const { uploadAsync } = useUploadVideo({
    showToast: false,
    onProgress: setUploadProgress,
  });

  const { completeAsync: completeMobileUploadAsync } =
    useCompleteMobileUpload();

  const draftConfig = video?.draftConfig;
  const scriptText = isTokenMode
    ? (tokenScript ?? '')
    : draftConfig && typeof draftConfig === 'object'
      ? (draftConfig.scriptText ?? '')
      : '';

  const initCamera = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPermissionState('denied');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
      }
      setPermissionState('granted');
    } catch (error) {
      logError('record.initCamera', error, { feature: 'record' });
      setPermissionState('denied');
    }
  }, []);

  useEffect(() => {
    initCamera();
    return () => {
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    };
  }, [initCamera]);

  // Re-attach the live stream to the preview <video> whenever the live view is
  // (re)mounted — e.g. after returning from the review screen via "Try again".
  // Without this the element from a fresh mount has no srcObject and shows black.
  useEffect(() => {
    if (state !== 'idle' && state !== 'countdown' && state !== 'recording') {
      return;
    }
    const el = videoElRef.current;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
    }
  }, [state]);

  useEffect(() => {
    if (state !== 'recording' && state !== 'uploading' && state !== 'review') {
      return;
    }
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  // Release the preview object URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  useEffect(() => {
    if (state === 'recording') {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const handleRecord = useCallback(() => {
    if (!streamRef.current) return;
    setState('countdown');
    setCountdown(3);

    let count = 3;
    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(streamRef.current as MediaStream, {
          mimeType: mimeType || undefined,
        });
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.start(1000);
        recorderRef.current = recorder;
        setState('recording');
        teleprompterRef.current?.start();
      } else {
        setCountdown(count);
      }
    }, 1000);
  }, []);

  // Stop recording and move to the review screen — the user decides whether to
  // keep this take or re-record before we upload anything.
  const handleStop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    teleprompterRef.current?.stop();

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        resolve(new Blob(chunksRef.current, { type: mimeType }));
      };
      recorder.stop();
    });

    // Turn the live camera off while reviewing so the preview unambiguously
    // shows the *recording*, not the live feed.
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    if (videoElRef.current) videoElRef.current.srcObject = null;

    const ext = getFileExtension(blob.type);
    recordedFileRef.current = new File(
      [blob],
      `talking-head-${videoId}.${ext}`,
      { type: blob.type }
    );
    setRecordedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setState('review');
  }, [videoId]);

  // Keep this take — upload it and attach it to the draft.
  const handleUseRecording = useCallback(async () => {
    const file = recordedFileRef.current;
    if (!file) return;

    setState('uploading');
    setUploadProgress(0);
    try {
      if (isTokenMode && uploadToken) {
        // Signed-out fallback: re-verify for a fresh presigned URL (the
        // mount-time one may be near expiry), PUT to S3, then mark complete.
        // The desktop's mobile-status poll picks it up — no video PATCH needed.
        const { uploadUrl } = await verifyMobileUploadToken(uploadToken);
        await putRecordingToS3(uploadUrl, file, setUploadProgress);
        await completeMobileUploadAsync(uploadToken);
        setState('done');
        return;
      }

      const result = await uploadAsync(file);
      await updateVideoAsync({
        id: videoId,
        draftConfig: { talkingHeadUrl: result.url },
      });
      setState('done');
    } catch (error) {
      logError('record.upload', error, {
        feature: 'record',
        extra: { videoId },
      });
      // Stay on review so the recording isn't lost — they can try uploading again.
      setState('review');
    }
  }, [
    videoId,
    uploadToken,
    isTokenMode,
    uploadAsync,
    updateVideoAsync,
    completeMobileUploadAsync,
  ]);

  // Discard this take and go back to the teleprompter to record again.
  const handleRetry = useCallback(async () => {
    recordedFileRef.current = null;
    setRecordedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setUploadProgress(0);
    // The camera was stopped for the review — bring it back before re-recording.
    if (!streamRef.current) await initCamera();
    setState('idle');
  }, [initCamera]);

  useEffect(() => {
    if (state !== 'done') return;
    const timeout = setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        navigate({ to: routes.home });
        return;
      }
      // Best-effort close for a script-opened tab; a no-op otherwise.
      try {
        window.close();
      } catch {
        // ignore
      }
      // In the signed-out token fallback there's no session to land on, so
      // don't bounce to /dashboard — it would redirect to /sign-in. The success
      // screen already tells them they can close the tab. Signed-in viewers
      // (even via a magic link) go back to their dashboard as normal.
      if (!isTokenMode) {
        navigate({ to: routes.home });
      }
    }, 1500);
    return () => clearTimeout(timeout);
  }, [state, isTokenMode, navigate, routes.home]);

  if (
    isSessionPending ||
    isVideoLoading ||
    (isTokenMode && tokenState === 'loading')
  ) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-black">
        <Loader2Icon className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (videoGone) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <VideoOffIcon className="h-12 w-12 text-white/60" />
        <h2 className="text-xl font-semibold text-white">
          This recording session has ended
        </h2>
        <p className="max-w-sm text-sm text-white/60">
          The video you were recording for is no longer available — it was
          discarded on the other device. You can safely close this tab.
        </p>
        <Button variant="outline" asChild>
          <Link to={ROUTES.dashboard}>Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (permissionState === 'denied') {
    const isNative = Capacitor.isNativePlatform();
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <CameraOffIcon className="h-12 w-12 text-white/60" />
        <h2 className="text-xl font-semibold text-white">
          Camera access required
        </h2>
        <p className="max-w-sm text-sm text-white/60">
          {isNative
            ? 'Allow camera and microphone access in your device settings, then reopen this screen.'
            : 'Allow camera and microphone access in your browser settings, then reload this page.'}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            if (isNative) initCamera();
            else window.location.reload();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (permissionState === 'granted' && !scriptText && state === 'idle') {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <VideoOffIcon className="h-12 w-12 text-white/60" />
        <h2 className="text-xl font-semibold text-white">
          No script configured
        </h2>
        <p className="max-w-sm text-sm text-white/60">
          Go back to the video wizard and complete the script step first.
        </p>
        <Button variant="outline" asChild>
          <Link to={ROUTES.dashboard}>Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (state === 'review' && recordedUrl) {
    return (
      <div className="flex min-h-svh flex-col bg-black">
        {/* Video gets its own region so the native control bar never overlaps —
            and intercepts taps from — the action buttons below. */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {/* biome-ignore lint/a11y/useMediaCaption: user's own recording preview */}
          <video
            key={recordedUrl}
            ref={(el) => {
              if (el) void el.play().catch(() => {});
            }}
            src={recordedUrl}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 bg-black px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">
          <p className="text-center text-sm text-white/70">
            Happy with this take?
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 bg-white/10 text-white hover:bg-white/20"
              onClick={handleRetry}
            >
              <RotateCcwIcon className="mr-2 h-4 w-4" />
              Try again
            </Button>
            <Button className="flex-1" onClick={handleUseRecording}>
              <CheckIcon className="mr-2 h-4 w-4" />
              Use this recording
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-black px-6 text-center">
        <CheckCircle2Icon className="h-16 w-16 text-green-500" />
        <h2 className="text-2xl font-semibold text-white">
          Recording uploaded!
        </h2>
        <p className="max-w-sm text-sm text-white/60">
          {isTokenMode
            ? 'Your recording is on its way — head back to your computer to finish the video. You can close this tab.'
            : 'Returning you to your dashboard. You can re-record any time from the video wizard.'}
        </p>
        {!isTokenMode && (
          <Button variant="outline" asChild>
            <Link to={ROUTES.dashboard}>
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-svh overflow-hidden bg-black">
      <video
        ref={videoElRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />

      {state === 'countdown' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
          <span className="text-8xl font-bold text-white drop-shadow-lg">
            {countdown}
          </span>
        </div>
      )}

      {state === 'uploading' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/60">
          <Loader2Icon className="h-10 w-10 animate-spin text-white" />
          <p className="text-lg font-medium text-white">Uploading...</p>
          <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-sm text-white/60">{uploadProgress}%</p>
        </div>
      )}

      {/* Idle: keep the frame clean — just hint that a teleprompter is ready.
          The script itself only appears once recording starts. */}
      {scriptText && state === 'idle' && (
        <div className="pointer-events-none absolute bottom-[260px] left-0 right-0 z-20 flex justify-center px-8">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 py-2 backdrop-blur-sm">
            <ScrollTextIcon className="h-4 w-4 shrink-0 text-white/70" />
            <span className="text-sm text-white/70">
              Your script appears when you start recording
            </span>
          </div>
        </div>
      )}

      {/* Mounted from the countdown so the scroll handle is ready by the time
          recording begins; the text reveals here, then scrolls on record. */}
      {scriptText && (state === 'countdown' || state === 'recording') && (
        <TeleprompterOverlay
          script={scriptText}
          speed={scrollSpeed}
          controlRef={teleprompterRef}
        />
      )}

      {(state === 'idle' || state === 'recording') && (
        <RecordingControls
          isRecording={state === 'recording'}
          scrollSpeed={scrollSpeed}
          elapsedSeconds={elapsedSeconds}
          onRecord={handleRecord}
          onStop={handleStop}
          onSpeedChange={setScrollSpeed}
        />
      )}
    </div>
  );
}
