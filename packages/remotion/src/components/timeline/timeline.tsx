import type React from 'react';
import { useCallback, useMemo } from 'react';
import type { Scene } from '../../types/video-config';

export interface TimelineProps {
  /** All scenes in the video */
  scenes: Scene[];
  /** Total duration in frames */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
  /** Current playback frame */
  currentFrame: number;
  /** Currently selected scene ID */
  selectedSceneId?: string;
  /** Callback when a scene is selected */
  onSceneSelect?: (sceneId: string) => void;
  /** Callback when a scene is right-clicked (for swap clip menu) */
  onSceneContextMenu?: (sceneId: string, event: React.MouseEvent) => void;
  /** Callback when seeking to a frame */
  onSeek?: (frame: number) => void;
  /** Callback when scene trim is changed */
  onSceneTrimChange?: (
    sceneId: string,
    trimStart: number,
    trimEnd: number
  ) => void;
  /** Additional className */
  className?: string;
}

const TIMELINE_HEIGHT = 80;
const SCENE_HEIGHT = 60;
const SCENE_GAP = 4;

/**
 * Format frame number as timecode (MM:SS)
 */
function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Timeline - Visual editor for video scenes
 *
 * Features:
 * - Click scene to select
 * - Right-click scene for context menu (swap clip)
 * - Click timeline track to seek
 * - Visual playhead indicator
 * - Scene duration display
 */
export const Timeline: React.FC<TimelineProps> = ({
  scenes,
  durationInFrames,
  fps,
  currentFrame,
  selectedSceneId,
  onSceneSelect,
  onSceneContextMenu,
  onSeek,
  className,
}) => {
  // Calculate scene positions as percentages
  const scenePositions = useMemo(() => {
    return scenes.map((scene) => ({
      scene,
      left: (scene.startFrame / durationInFrames) * 100,
      width: (scene.durationInFrames / durationInFrames) * 100,
    }));
  }, [scenes, durationInFrames]);

  // Playhead position
  const playheadPosition = (currentFrame / durationInFrames) * 100;

  // Handle click on timeline track for seeking
  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek) return;

      const target = event.currentTarget as HTMLDivElement;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percentage = x / rect.width;
      const frame = Math.round(percentage * durationInFrames);
      onSeek(Math.max(0, Math.min(frame, durationInFrames - 1)));
    },
    [durationInFrames, onSeek]
  );

  // Handle keyboard navigation on timeline track
  const handleTrackKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onSeek) return;

      const step = event.shiftKey ? fps : 1;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onSeek(Math.min(currentFrame + step, durationInFrames - 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onSeek(Math.max(currentFrame - step, 0));
      }
    },
    [currentFrame, durationInFrames, fps, onSeek]
  );

  // Handle scene click
  const handleSceneClick = useCallback(
    (sceneId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      onSceneSelect?.(sceneId);
    },
    [onSceneSelect]
  );

  // Handle scene keyboard selection
  const handleSceneKeyDown = useCallback(
    (sceneId: string, event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onSceneSelect?.(sceneId);
      }
    },
    [onSceneSelect]
  );

  // Handle scene right-click
  const handleSceneContextMenu = useCallback(
    (sceneId: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSceneContextMenu?.(sceneId, event);
    },
    [onSceneContextMenu]
  );

  // Get scene colors based on type
  const getSceneColor = (scene: Scene, isSelected: boolean) => {
    const baseColor = scene.type === 'talking-head' ? '#3b82f6' : '#10b981';
    return isSelected ? baseColor : `${baseColor}99`;
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        height: TIMELINE_HEIGHT,
        backgroundColor: '#1a1a2e',
        borderRadius: 8,
        padding: '10px 0',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Time markers */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          paddingRight: 8,
          fontSize: 10,
          color: '#888',
          fontFamily: 'monospace',
        }}
      >
        <span>0:00</span>
        <span style={{ marginLeft: 'auto' }}>
          {formatTimecode(durationInFrames, fps)}
        </span>
      </div>

      {/* Timeline track */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={durationInFrames}
        aria-valuenow={currentFrame}
        aria-valuetext={formatTimecode(currentFrame, fps)}
        style={{
          position: 'absolute',
          top: 20,
          left: 8,
          right: 8,
          height: SCENE_HEIGHT,
          backgroundColor: '#2a2a4a',
          borderRadius: 4,
          cursor: 'pointer',
        }}
        onClick={handleTrackClick}
        onKeyDown={handleTrackKeyDown}
      >
        {/* Scenes */}
        {scenePositions.map(({ scene, left, width }) => (
          <button
            type="button"
            key={scene.id}
            aria-label={`${scene.type === 'talking-head' ? 'Talking Head' : 'B-Roll'} scene, ${formatTimecode(scene.durationInFrames, fps)} duration`}
            aria-pressed={scene.id === selectedSceneId}
            style={{
              position: 'absolute',
              left: `${left}%`,
              width: `${width}%`,
              top: SCENE_GAP,
              height: SCENE_HEIGHT - SCENE_GAP * 2,
              backgroundColor: getSceneColor(
                scene,
                scene.id === selectedSceneId
              ),
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 500,
              color: 'white',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 8px',
              boxSizing: 'border-box',
              border: scene.id === selectedSceneId ? '2px solid white' : 'none',
              transition: 'background-color 0.15s, border 0.15s',
              fontFamily: 'inherit',
            }}
            onClick={(e) => handleSceneClick(scene.id, e)}
            onKeyDown={(e) => handleSceneKeyDown(scene.id, e)}
            onContextMenu={(e) => handleSceneContextMenu(scene.id, e)}
            title={`${scene.type === 'talking-head' ? 'Talking Head' : 'B-Roll'} - ${formatTimecode(scene.durationInFrames, fps)}`}
          >
            {width > 8 && (
              <span>
                {scene.type === 'talking-head' ? 'TH' : 'BR'}{' '}
                {formatTimecode(scene.durationInFrames, fps)}
              </span>
            )}
          </button>
        ))}

        {/* Playhead */}
        <div
          style={{
            position: 'absolute',
            left: `${playheadPosition}%`,
            top: -4,
            bottom: -4,
            width: 2,
            backgroundColor: '#ef4444',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {/* Playhead handle */}
          <div
            style={{
              position: 'absolute',
              top: -6,
              left: -5,
              width: 12,
              height: 12,
              backgroundColor: '#ef4444',
              borderRadius: '50%',
            }}
          />
        </div>
      </div>

      {/* Current time display */}
      <div
        style={{
          position: 'absolute',
          bottom: 2,
          left: 8,
          fontSize: 11,
          color: '#aaa',
          fontFamily: 'monospace',
        }}
      >
        {formatTimecode(currentFrame, fps)} /{' '}
        {formatTimecode(durationInFrames, fps)}
      </div>
    </div>
  );
};
